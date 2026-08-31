import { NextResponse } from "next/server";
import { z } from "zod";
import { rewriteText } from "@/lib/ai/service";
import { RewriteMode } from "@/lib/ai/schemas";
import { AudienceInput, guard } from "@/lib/ai/route-helpers";

export const maxDuration = 45;

const Input = z
  .object({
    text: z.string().trim().min(1, "There's no text to rewrite.").max(6000),
    mode: RewriteMode,
    presentationId: z.string().uuid().nullable().optional(),
  })
  .merge(AudienceInput);

export async function POST(request: Request) {
  const guarded = await guard(request, Input, "light");
  if (!guarded.ok) return guarded.response;

  const { text, mode, presentationId, ...context } = guarded.input;
  const result = await rewriteText(text, mode, context, presentationId ?? null);

  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ options: result.options, source: result.source });
}
