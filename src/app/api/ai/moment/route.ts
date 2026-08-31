import { NextResponse } from "next/server";
import { z } from "zod";
import { rewriteMoment } from "@/lib/ai/service";
import { guard } from "@/lib/ai/route-helpers";
import { NarrativeRole } from "@/lib/schema/narrative";

export const maxDuration = 30;

const Input = z.object({
  title: z.string().max(160).default(""),
  role: NarrativeRole,
  purpose: z.string().max(600).default(""),
  takeaway: z.string().max(600).default(""),
  movementPurpose: z.string().max(600).default(""),
});

/** Rewrites one beat. Nothing else in the map is touched. */
export async function POST(request: Request) {
  const guarded = await guard(request, Input, "light");
  if (!guarded.ok) return guarded.response;

  const result = await rewriteMoment(guarded.input);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json(result.data);
}
