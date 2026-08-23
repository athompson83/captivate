import { NextResponse } from "next/server";
import { z } from "zod";
import { buildSingleScene } from "@/lib/ai/service";
import { AudienceInput, guard, LIMITS } from "@/lib/ai/route-helpers";

export const maxDuration = 60;

const Input = z
  .object({
    instruction: z.string().trim().min(3, "Say what the scene should do.").max(1000),
    presentationId: z.string().uuid().nullable().optional(),
    presentationTitle: z.string().max(240).optional(),
    neighbouring: z.array(z.string().max(240)).max(6).optional(),
  })
  .merge(AudienceInput);

/** Generates one scene. The client decides where to insert it. */
export async function POST(request: Request) {
  const guarded = await guard(request, Input, LIMITS.heavy, ["scene"]);
  if (!guarded.ok) return guarded.response;

  const { instruction, presentationId, ...context } = guarded.input;
  const result = await buildSingleScene(instruction, context, presentationId ?? null);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json(result.data);
}
