import "server-only";

import { supabaseServer } from "@/lib/supabase/server";

/**
 * Rate limiting for model calls.
 *
 * Counts the caller's own `ai_generations` rows in a rolling window. This is
 * database-backed rather than in-memory because the app runs on serverless
 * functions where per-instance counters are close to meaningless — a user can
 * simply land on a cold instance.
 *
 * The limits protect the deployment's spend, not the user; they are generous
 * enough that ordinary authoring never touches them.
 */

export interface RateLimit {
  windowMinutes: number;
  max: number;
}

/** Full generations are expensive; text tools are cheap and used constantly. */
export const LIMITS = {
  heavy: { windowMinutes: 60, max: 30 } satisfies RateLimit,
  light: { windowMinutes: 60, max: 200 } satisfies RateLimit,
};

export type RateVerdict =
  { allowed: true } | { allowed: false; retryAfterMinutes: number; message: string };

export async function checkRateLimit(limit: RateLimit, kinds: string[]): Promise<RateVerdict> {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { allowed: false, retryAfterMinutes: 0, message: "You're signed out." };
    }

    const since = new Date(Date.now() - limit.windowMinutes * 60_000).toISOString();
    const { count, error } = await supabase
      .from("ai_generations")
      .select("id", { count: "exact", head: true })
      .eq("owner_id", user.id)
      .in("kind", kinds)
      .gte("created_at", since);

    // If the counter itself is broken, allow the request rather than blocking
    // all AI on an infrastructure hiccup.
    if (error) return { allowed: true };

    if ((count ?? 0) >= limit.max) {
      return {
        allowed: false,
        retryAfterMinutes: limit.windowMinutes,
        message: `You've used ${limit.max} AI generations in the last hour. Try again shortly — nothing you've made is affected.`,
      };
    }

    return { allowed: true };
  } catch {
    return { allowed: true };
  }
}
