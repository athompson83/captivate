import { NextResponse } from "next/server";
import { z } from "zod";
import { writeSpeakerNotes } from "@/lib/ai/service";
import { AudienceInput, guard } from "@/lib/ai/route-helpers";
import { supabaseServer } from "@/lib/supabase/server";
import { parseSceneContent, plainText } from "@/lib/schema/presentation";

export const maxDuration = 45;

const Input = z
  .object({
    presentationId: z.string().uuid(),
    sceneId: z.string().uuid(),
    existingNotes: z.string().max(20000).default(""),
  })
  .merge(AudienceInput);

/**
 * Drafts speaker notes for a scene.
 *
 * The scene's text is read server-side from the database rather than taken from
 * the request, so the model always sees what is actually saved and a client
 * cannot use this route to summarise arbitrary text.
 */
export async function POST(request: Request) {
  const guarded = await guard(request, Input, "light", ["speaker_notes"]);
  if (!guarded.ok) return guarded.response;

  const { presentationId, sceneId, existingNotes, ...context } = guarded.input;

  const supabase = await supabaseServer();
  const [sceneRes, presentationRes] = await Promise.all([
    supabase
      .from("scenes")
      .select("title, content")
      .eq("id", sceneId)
      .eq("presentation_id", presentationId)
      .maybeSingle(),
    supabase.from("presentations").select("title").eq("id", presentationId).maybeSingle(),
  ]);

  if (!sceneRes.data) {
    return NextResponse.json({ error: "That scene couldn't be found." }, { status: 404 });
  }

  const { content } = parseSceneContent(sceneRes.data.content);
  const sceneText = content.elements
    .map((el) => {
      switch (el.type) {
        case "heading":
        case "text":
        case "quote":
          return plainText(el.content);
        case "list":
          return el.items.map((i) => `• ${plainText(i)}`).join("\n");
        case "callout":
          return `${el.title}: ${plainText(el.content)}`;
        case "chart":
          return `Chart: ${el.summary || el.data.map((d) => `${d.label} ${d.value}`).join(", ")}`;
        case "image":
          return el.alt ? `Image: ${el.alt}` : "";
        case "code":
          return `Code (${el.language})`;
        default:
          return "";
      }
    })
    .filter(Boolean)
    .join("\n");

  const result = await writeSpeakerNotes(
    { title: sceneRes.data.title, text: sceneText, existingNotes },
    { ...context, presentationTitle: presentationRes.data?.title },
    presentationId,
  );

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ notes: result.notes });
}
