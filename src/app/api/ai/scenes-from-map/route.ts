import { NextResponse } from "next/server";
import { z } from "zod";
import { buildScenesFromMap } from "@/lib/ai/service";
import { AudienceInput, guard } from "@/lib/ai/route-helpers";
import { NarrativeRole, VisualIntent } from "@/lib/schema/narrative";

// The platform ceiling: one scenes call at full depth plus the parallel
// drawing pass is minutes of model time, and a duration cap that fires
// mid-generation bills the tokens and saves nothing.
export const maxDuration = 300;

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
  .merge(AudienceInput);

/** An accepted narrative map → the scenes that render it. */
export async function POST(request: Request) {
  const guarded = await guard(request, Input, "deck");
  if (!guarded.ok) return guarded.response;

  const { prompt, presentationId, briefs, depth, ...context } = guarded.input;
  // The briefs carry the map's own time distribution; their sum is the talk's
  // length, which decides how many staged drawings the deck earns.
  const totalSeconds = briefs.reduce((sum, brief) => sum + brief.estimatedSeconds, 0);
  const result = await buildScenesFromMap(
    briefs,
    prompt,
    context,
    presentationId,
    depth,
    totalSeconds,
  );

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json(result.data);
}
