import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { isAiConfigured } from "@/lib/ai/provider";

/** Lets the UI say honestly whether a model is available on this deployment. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ configured: false }, { status: 401 });
  return NextResponse.json(
    { configured: isAiConfigured() },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
