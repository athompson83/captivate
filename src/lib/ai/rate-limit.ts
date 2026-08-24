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
 *
 * Two steps, and the order is the point. `checkRateLimit` is a cheap read that
 * turns an obviously-over-limit request into a 429 before the body is parsed.
 * `reserve` is the one that actually bounds spend: it counts and writes the
 * ledger row in a single locked transaction, so a caller who fires fifty
 * requests at once cannot have all fifty read the same count and spend. Only
 * the reservation is authoritative; the pre-filter exists for the error
 * message and the status code.
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

/** A claim on one model call. Spend it by calling `complete`. */
export interface Reservation {
  id: string;
}

export type ReserveOutcome =
  { ok: true; reservation: Reservation } | { ok: false; error: string; retryAfterMinutes: number };

/**
 * Claims one model call before it is made.
 *
 * Returns a ticket or a refusal — never "probably fine". A refusal means
 * nothing was spent, because the ledger row that bounds the limit is written
 * by the same statement that counts, under a per-user lock.
 *
 * `kind` is what this call is recorded as; `countKinds` is the group it counts
 * against, which is usually wider (a rewrite and a moment draw on the same
 * light budget).
 */
export async function reserve(
  kind: string,
  countKinds: string[],
  prompt: string,
  presentationId: string | null,
  limit: RateLimit,
): Promise<ReserveOutcome> {
  const refused = (error: string): ReserveOutcome => ({
    ok: false,
    error,
    retryAfterMinutes: limit.windowMinutes,
  });

  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc("captivate_reserve_generation", {
      p_kind: kind,
      p_count_kinds: countKinds,
      p_prompt: prompt.slice(0, 4000),
      p_presentation_id: presentationId,
      p_window_minutes: limit.windowMinutes,
      p_max: limit.max,
    });

    // Unlike the pre-filter, this one fails closed. The pre-filter can be
    // wrong in the safe direction — it only decides whether to reject early —
    // but if the reservation cannot be written there is nothing counting the
    // call, and an uncounted call is exactly what the limit exists to stop.
    if (error || !data) {
      return refused(
        error
          ? "Couldn't reserve an AI call just now. Nothing was spent — try again."
          : `You've used ${limit.max} AI generations in the last hour. Try again shortly — nothing you've made is affected.`,
      );
    }
    return { ok: true, reservation: { id: data as unknown as string } };
  } catch {
    return refused("Couldn't reserve an AI call just now. Nothing was spent — try again.");
  }
}

/**
 * Records what the reserved call actually did.
 *
 * Best-effort on purpose: the reservation already counts against the limit, so
 * a failure here loses cost detail rather than spend protection. It cannot be
 * used to undo a reservation — the function it calls only moves a row from
 * pending to a terminal status, never back.
 */
export async function complete(
  reservation: Reservation,
  result: {
    status: "succeeded" | "failed" | "invalid_output";
    model?: string;
    usage?: { input: number; output: number };
    error?: string;
  },
): Promise<void> {
  try {
    const supabase = await supabaseServer();
    await supabase.rpc("captivate_complete_generation", {
      p_id: reservation.id,
      p_status: result.status,
      p_model: result.model ?? null,
      p_input_tokens: result.usage?.input ?? null,
      p_output_tokens: result.usage?.output ?? null,
      p_error: result.error?.slice(0, 500) ?? null,
    });
  } catch {
    // Cost detail is best-effort by design; the row and its count remain.
  }
}
