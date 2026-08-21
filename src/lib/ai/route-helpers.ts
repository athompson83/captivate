import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { checkRateLimit, LIMITS, type RateLimit } from "./rate-limit";

/**
 * Shared guard for every AI route: authenticated, rate limited, and validated
 * before a single token is spent.
 */
export async function guard<T>(
  request: Request,
  schema: z.ZodType<T>,
  limit: RateLimit,
  kinds: string[],
): Promise<{ ok: true; input: T } | { ok: false; response: NextResponse }> {
  const user = await getCurrentUser();
  if (!user) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: "You're signed out. Sign in again to continue." },
        { status: 401 },
      ),
    };
  }

  const verdict = await checkRateLimit(limit, kinds);
  if (!verdict.allowed) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: verdict.message },
        { status: 429, headers: { "Retry-After": String(verdict.retryAfterMinutes * 60) } },
      ),
    };
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return {
      ok: false,
      response: NextResponse.json({ error: "Malformed request." }, { status: 400 }),
    };
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: parsed.error.issues[0]?.message ?? "That request wasn't valid." },
        { status: 400 },
      ),
    };
  }

  return { ok: true, input: parsed.data };
}

export const AudienceInput = z.object({
  audience: z.string().max(160).optional(),
  tone: z.string().max(80).optional(),
  sceneCount: z.number().int().min(3).max(24).optional(),
});

export { LIMITS };
