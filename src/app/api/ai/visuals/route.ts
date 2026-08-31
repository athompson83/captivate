import { NextResponse } from "next/server";
import { z } from "zod";
import { suggestVisuals } from "@/lib/ai/service";
import { AudienceInput, guard } from "@/lib/ai/route-helpers";

export const maxDuration = 45;

const Input = z
  .object({
    title: z.string().max(240).default(""),
    text: z.string().max(4000).default(""),
    presentationId: z.string().uuid().nullable().optional(),
  })
  .merge(AudienceInput);

export async function POST(request: Request) {
  const guarded = await guard(request, Input, "light", ["visuals"]);
  if (!guarded.ok) return guarded.response;

  const { title, text, presentationId, ...context } = guarded.input;
  const result = await suggestVisuals({ title, text }, context, presentationId ?? null);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ suggestions: result.suggestions });
}
