import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { isStockSearchConfigured, searchStockPhotos } from "@/lib/ai/visual-sourcing";
import { checkRateLimit, LIMITS } from "@/lib/ai/rate-limit";

export const maxDuration = 20;

const Input = z.object({ query: z.string().max(200) });

/**
 * Stock photo search.
 *
 * Rate limited but not budgeted: a search costs the deployment nothing, so it
 * has no reservation to take. The limiter is only here to stop the provider
 * being hammered through us.
 */
export async function POST(request: Request) {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "You're signed out." }, { status: 401 });

  if (!isStockSearchConfigured()) {
    return NextResponse.json(
      { error: "Image search isn't configured on this deployment." },
      { status: 501 },
    );
  }

  const verdict = await checkRateLimit(LIMITS.light, ["visuals", "stock_search"]);
  if (!verdict.allowed) {
    return NextResponse.json(
      { error: verdict.message },
      { status: 429, headers: { "Retry-After": String(verdict.retryAfterMinutes * 60) } },
    );
  }

  const parsed = Input.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Malformed request." }, { status: 400 });

  const result = await searchStockPhotos(parsed.data.query);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 502 });
  return NextResponse.json({ results: result.data });
}
