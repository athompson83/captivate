import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/supabase/server";
import { isAiConfigured } from "@/lib/ai/provider";
import {
  isImageGenerationConfigured,
  isStockSearchConfigured,
} from "@/lib/ai/visual-sourcing";

/**
 * Lets the UI say honestly whether a model is available on this deployment.
 *
 * Three separate answers, because they are three separate keys and a
 * deployment can perfectly well have text generation and no image search. The
 * picker hides the tabs it cannot serve rather than showing them disabled — an
 * unbuilt path is absent, not present-and-broken.
 */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { configured: false, stockSearch: false, imageGeneration: false },
      { status: 401 },
    );
  }
  return NextResponse.json(
    {
      configured: isAiConfigured(),
      stockSearch: isStockSearchConfigured(),
      imageGeneration: isImageGenerationConfigured(),
    },
    { headers: { "Cache-Control": "private, max-age=60" } },
  );
}
