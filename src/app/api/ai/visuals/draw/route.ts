import { NextResponse } from "next/server";
import { keepAlive } from "@/lib/ai/keep-alive";
import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { generateDrawing, isAiConfigured } from "@/lib/ai/service";

export const maxDuration = 120;

const Input = z.object({
  prompt: z.string().min(1).max(1000),
  presentationId: z.uuid().nullish(),
});

/**
 * One staged line drawing, as validated path data.
 *
 * A text call, not an image call: availability rides `isAiConfigured` rather
 * than the image-generation flag, and the reservation (inside
 * `generateDrawing`) counts it in the heavy text bucket. Model output passes
 * the same path grammar hand-entered data would — nothing reaches the
 * document that did not.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You're signed out." }, { status: 401 });

  if (!isAiConfigured()) {
    return NextResponse.json({ error: "AI isn't configured on this deployment." }, { status: 501 });
  }

  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "Describe the drawing you want." }, { status: 400 });
  }

  return keepAlive(async () => {
    const result = await generateDrawing(parsed.data.prompt, parsed.data.presentationId ?? null);
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
    return NextResponse.json({ drawing: result.drawing });
  });
}
