import { NextResponse } from "next/server";
import { z } from "zod";
import { buildNarrativeMap } from "@/lib/ai/service";
import { AudienceInput, guard, LIMITS } from "@/lib/ai/route-helpers";
import { listEvidence } from "@/lib/data/evidence";

export const maxDuration = 60;

const Input = z
  .object({
    prompt: z.string().trim().min(8, "Tell us a little more about the topic.").max(4000),
    /** Requested running time. Distributes the map's weights, not its size. */
    totalSeconds: z.number().int().min(60).max(14_400).default(900),
    recommendedShape: z.string().max(4000).optional(),
  })
  .merge(AudienceInput);

/**
 * Prompt → proposed argument.
 *
 * Nothing is created. The user reviews and edits the map, and only then are
 * scenes generated from it.
 *
 * The evidence the model may cite is read here, server-side, from what this
 * user actually owns — never taken from the request. A client that could name
 * its own evidence list would be a client that could make the model cite
 * somebody else's material.
 */
export async function POST(request: Request) {
  const guarded = await guard(request, Input, LIMITS.heavy, ["map", "presentation"]);
  if (!guarded.ok) return guarded.response;

  const { prompt, totalSeconds, recommendedShape, ...context } = guarded.input;
  const available = await listEvidence();

  const result = await buildNarrativeMap(prompt, {
    ...context,
    totalSeconds,
    available,
    recommendedShape,
  });

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ ...result.data, available });
}
