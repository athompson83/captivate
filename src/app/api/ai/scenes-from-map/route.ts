import { NextResponse } from "next/server";
import { keepAlive } from "@/lib/ai/keep-alive";
import { z } from "zod";
import { ROOM_BUDGET_MS, buildScenesFromMap, dressRoom } from "@/lib/ai/service";
import { roomFor } from "@/lib/ai/look";
import { JourneyConfig } from "@/lib/schema/presentation";
import { supabaseServer } from "@/lib/supabase/server";
import { planSceneWrites } from "@/lib/narrative/scene-writes";
import { AudienceInput, ReferenceInput, guard } from "@/lib/ai/route-helpers";
import { NarrativeRole, VisualIntent } from "@/lib/schema/narrative";

// The platform ceiling: one scenes call at full depth plus the parallel
// drawing pass is minutes of model time, and a duration cap that fires
// mid-generation bills the tokens and saves nothing.
export const maxDuration = 300;
/** What the room may have of the route's ceiling, after everything else. */
const ROUTE_RESERVE_MS = 20_000;

/**
 * A brief per moment, validated on the way in.
 *
 * The client sends the accepted map because the map is what the *user* just
 * approved on screen — reading it back from the database would generate from
 * whatever was last written rather than from what they agreed to. Every field
 * is bounded, so a client cannot use this route to smuggle an arbitrarily long
 * prompt into the model.
 */
const Brief = z.object({
  momentId: z.string().uuid(),
  movementLabel: z.string().max(48).default(""),
  movementTitle: z.string().max(160).default(""),
  movementPurpose: z.string().max(600).default(""),
  title: z.string().max(160),
  role: NarrativeRole,
  purpose: z.string().max(600).default(""),
  takeaway: z.string().max(600).default(""),
  estimatedSeconds: z.number().int().min(0).max(3600).default(0),
  visualIntent: VisualIntent.default("auto"),
  intentAuthored: z.boolean().default(false),
  instructions: z.string().max(1200).default(""),
  evidence: z
    .array(
      z.object({ kind: z.enum(["asset", "note"]), id: z.string(), label: z.string().max(200) }),
    )
    .max(24)
    .default([]),
  previousTitle: z.string().max(160).nullable().default(null),
  nextTitle: z.string().max(160).nullable().default(null),
  endsMovement: z.boolean().default(false),
  nextMovementLabel: z.string().max(48).nullable().default(null),
});

const Input = z
  .object({
    prompt: z.string().trim().min(1).max(4000),
    presentationId: z.string().uuid().nullable().default(null),
    briefs: z.array(Brief).min(1).max(60),
    /** How much writing to do: the full talk, or a frame the author fills in. */
    depth: z.enum(["outline", "full"]).default("full"),
  })
  .merge(AudienceInput)
  .merge(ReferenceInput);

/** An accepted narrative map → the scenes that render it. */
export async function POST(request: Request) {
  const guarded = await guard(request, Input, "deck");
  if (!guarded.ok) return guarded.response;

  return keepAlive(async () => {
    const started = Date.now();
    const { prompt, presentationId, briefs, depth, ...context } = guarded.input;
    // The briefs carry the map's own time distribution; their sum is the talk's
    // length, which decides how many staged drawings the deck earns.
    const totalSeconds = briefs.reduce((sum, brief) => sum + brief.estimatedSeconds, 0);

    // Claimed here rather than in the browser, and that distinction is the
    // point: only the thing doing the writing knows when the writing started,
    // which is what lets the claim expire instead of spinning for ever.
    //
    // This route hands its scenes back for the client to save one at a time,
    // so a phone that locks between the answer arriving and the last save
    // leaves a half-written deck. Marking it here means the deck says
    // "never finished writing" when the author returns, and offers to finish,
    // rather than looking done and being half a deck.
    // The deck's theme and journey, read once: the theme's palette goes into
    // every generated picture, and the journey is what the look and the room
    // are written onto afterwards.
    let deck: { title: string; themeId: string | null; journey: JourneyConfig } | null = null;
    if (presentationId) {
      const supabase = await supabaseServer();
      const [{ data: row }] = await Promise.all([
        supabase
          .from("presentations")
          .select("title, theme_id, journey")
          .eq("id", presentationId)
          .maybeSingle(),
        supabase
          .from("presentations")
          .update({
            generation_status: "generating",
            generation_started_at: new Date().toISOString(),
          })
          .eq("id", presentationId),
      ]);
      const journey = JourneyConfig.safeParse(row?.journey ?? {});
      deck = {
        title: row?.title ?? "",
        themeId: row?.theme_id ?? null,
        journey: journey.success ? journey.data : JourneyConfig.parse({}),
      };
    }

    const result = await buildScenesFromMap(
      briefs,
      prompt,
      context,
      presentationId,
      depth,
      totalSeconds,
      { themeId: deck?.themeId ?? null, look: deck?.journey.look ?? "" },
    );

    if (!result.ok) {
      if (presentationId) {
        const supabase = await supabaseServer();
        await supabase
          .from("presentations")
          .update({ generation_status: "failed", generation_started_at: null })
          .eq("id", presentationId);
      }
      return NextResponse.json({ error: result.error }, { status: 502 });
    }

    // Written here rather than handed back for the browser to save.
    //
    // The loop that did this used to live in the page, which put a five-minute
    // job behind a phone staying awake: a lock screen between the answer
    // arriving and the last save left a deck half rewritten and looking
    // finished. There is no window to be interrupted in now.
    //
    // Without a presentation there is nothing to write to — the caller is
    // previewing — so the scenes go back as they always did.
    if (!presentationId) return NextResponse.json(result.data);

    const supabase = await supabaseServer();
    const [{ data: sceneRows }, { data: momentRows }] = await Promise.all([
      supabase
        .from("scenes")
        .select("id, moment_id, position")
        .eq("presentation_id", presentationId),
      supabase.from("moments").select("id, movement_id").eq("presentation_id", presentationId),
    ]);

    // The moments are read from the database rather than taken from the
    // request: which movement a moment belongs to is the server's fact, and a
    // brief could name one that has since moved or gone.
    const plan = planSceneWrites(
      (sceneRows ?? []).map((row) => ({
        id: row.id,
        momentId: row.moment_id,
        position: row.position,
      })),
      result.data.scenes,
      (momentRows ?? []).map((row) => ({ id: row.id, movementId: row.movement_id })),
    );

    const failures: string[] = [];
    for (const write of plan.writes) {
      const { error } =
        write.kind === "update"
          ? await supabase
              .from("scenes")
              .update({
                title: write.title,
                content: write.content as never,
                speaker_notes: write.speakerNotes,
              })
              .eq("id", write.id)
          : await supabase.from("scenes").insert({
              presentation_id: presentationId,
              section_id: write.sectionId,
              moment_id: write.momentId,
              position: write.position,
              title: write.title,
              content: write.content as never,
              speaker_notes: write.speakerNotes,
            } as never);
      if (error) failures.push(error.message);
    }

    // The look goes onto the journey, and the room behind the show is made
    // to it — once, for a deck that has no picture there yet. Last, because
    // it is the one picture the deck can open without, and within what the
    // route has left: the scene call can take minutes, and a room that
    // crosses the platform's ceiling leaves the deck marked generating.
    //
    // The journey is read again here, not taken from the snapshot at the
    // top: minutes have passed, and an author who moved the camera or chose
    // a backdrop meanwhile must not have it written over. Only the two
    // fields this route owns are merged in.
    if (deck && result.data.source === "model") {
      const readJourney = async () => {
        const { data: fresh } = await supabase
          .from("presentations")
          .select("journey")
          .eq("id", presentationId)
          .maybeSingle();
        const parsed = JourneyConfig.safeParse(fresh?.journey ?? {});
        return parsed.success ? parsed.data : JourneyConfig.parse({});
      };
      const before = await readJourney();
      const remaining = maxDuration * 1000 - (Date.now() - started) - ROUTE_RESERVE_MS;
      const room = before.backdrop.url
        ? null
        : await dressRoom({
            title: deck.title,
            look: result.data.look,
            roomQuery: result.data.roomQuery,
            themeId: deck.themeId,
            presentationId,
            budgetMs: Math.min(ROOM_BUDGET_MS, remaining),
          });
      const current = await readJourney();
      // The drawn room follows the look the first time a deck is given one.
      // A deck that already had a look keeps whatever room its author chose
      // since: the choice is theirs from then on, and a regeneration writes
      // the same look back anyway. So does a deck whose author changed the
      // room while this route was running — the journey read now differs
      // from the one read at the top — because an empty look is no proof
      // the room was never touched.
      const roomUntouched = current.backdrop.graphic === deck.journey.backdrop.graphic;
      const graphic =
        !current.look && result.data.look && roomUntouched
          ? roomFor(result.data.look)
          : current.backdrop.graphic;
      const journey: JourneyConfig = {
        ...current,
        look: result.data.look || current.look,
        backdrop:
          room && !current.backdrop.url
            ? { ...current.backdrop, ...room, graphic }
            : { ...current.backdrop, graphic },
      };
      await supabase
        .from("presentations")
        .update({ journey: journey as never })
        .eq("id", presentationId);
    }

    // Only a run that wrote everything it meant to may call the deck finished.
    // A partial one leaves the claim standing, so it expires into "never
    // finished writing" and offers to finish rather than looking done.
    if (failures.length === 0) {
      await supabase
        .from("presentations")
        .update({
          generation_status: result.data.source === "model" ? "ready" : "partial",
          generation_started_at: null,
        })
        .eq("id", presentationId);
    }

    return NextResponse.json({
      saved: plan.writes.length - failures.length,
      replaced: plan.replacing,
      created: plan.creating,
      unplaceable: plan.unplaceable,
      source: result.data.source,
      notice: result.data.notice,
      error: failures[0],
    });
  });
}
