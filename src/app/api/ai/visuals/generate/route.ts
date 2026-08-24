import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { generateImage, isImageGenerationConfigured } from "@/lib/ai/visual-sourcing";

export const maxDuration = 120;

const Input = z.object({ prompt: z.string().min(1).max(1000) });

/**
 * One image, medium quality, 16:9.
 *
 * No rate-limit pre-filter here, unlike the text routes: the budget
 * reservation inside `generateImage` is both the counter and the gate, and it
 * distinguishes "the deployment is out of budget" from "you have used your
 * day's allowance" — a message a generic 429 would flatten. It is taken before
 * the provider is called, so a refusal costs nothing.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You're signed out." }, { status: 401 });

  if (!isImageGenerationConfigured()) {
    return NextResponse.json(
      { error: "Image generation isn't configured on this deployment." },
      { status: 501 },
    );
  }

  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Describe the image you want." }, { status: 400 });

  const result = await generateImage(parsed.data.prompt);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ image: result.data });
}
