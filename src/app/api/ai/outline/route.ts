import { NextResponse } from "next/server";
import { z } from "zod";
import { buildOutline } from "@/lib/ai/service";
import { AudienceInput, guard, LIMITS } from "@/lib/ai/route-helpers";

export const maxDuration = 60;

const Input = z
  .object({ prompt: z.string().trim().min(8, "Tell us a little more about the topic.").max(4000) })
  .merge(AudienceInput);

/** Prompt → proposed structure. Nothing is created until the user approves it. */
export async function POST(request: Request) {
  const guarded = await guard(request, Input, LIMITS.heavy, ["outline", "presentation"]);
  if (!guarded.ok) return guarded.response;

  const { prompt, ...context } = guarded.input;
  const result = await buildOutline(prompt, context);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json(result.data);
}
