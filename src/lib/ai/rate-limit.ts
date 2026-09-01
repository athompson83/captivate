import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import type { RateLimit } from "@/lib/billing/plans";

/**
 * Rate limiting for model calls.
 *
 * Counts the caller's own `ai_generations` rows in a rolling window. This is
 * database-backed rather than in-memory because the app runs on serverless
 * functions where per-instance counters are close to meaningless — a user can
 * simply land on a cold instance.
 *
 * What counts is decided in one place, `captivate_count_generations`: a
 * reservation abandoned by a killed function, and a call that never reached
 * the model, are not spend and are not charged to anybody's allowance.
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

export type { RateLimit };

/**
 * How to describe the window a limit actually used.
 *
 * The free plan counts over a rolling 30 days, so a message that says "in the
 * last hour" would be a lie about billing — the worst kind of copy to get
 * wrong.
 */
function windowPhrase(limit: RateLimit): string {
  if (limit.windowMinutes >= 1440) {
    const days = Math.round(limit.windowMinutes / 1440);
    return `the last ${days} day${days === 1 ? "" : "s"}`;
  }
  if (limit.windowMinutes >= 60) {
    const hours = Math.round(limit.windowMinutes / 60);
    return `the last ${hours} hour${hours === 1 ? "" : "s"}`;
  }
  return `the last ${limit.windowMinutes} minutes`;
}

function overLimitMessage(limit: RateLimit): string {
  return `You've used ${limit.max} AI generations in ${windowPhrase(limit)}. Nothing you've made is affected.`;
}

export type RateVerdict =
  { allowed: true } | { allowed: false; retryAfterMinutes: number; message: string };

/**
 * How much of a group's allowance the caller has used.
 *
 * The database owns the definition — an abandoned reservation and a call that
 * never reached the model do not count — so the gate, this pre-filter and the
 * number on the settings page cannot drift apart. Null means the count could
 * not be read.
 */
export async function usedGenerations(
  kinds: string[],
  windowMinutes: number,
): Promise<number | null> {
  try {
    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc("captivate_count_generations", {
      p_count_kinds: kinds,
      p_window_minutes: windowMinutes,
    });
    if (error || typeof data !== "number") return null;
    return data;
  } catch {
    return null;
  }
}

/**
 * Every ceiling, not just the allowance.
 *
 * A paid plan has two — a 30-day allowance and an hourly burst — and a call
 * has to clear both. Checking only the first is what let the burst ceiling
 * exist as a number in a table and nowhere else.
 */
export async function checkRateLimits(
  limits: readonly RateLimit[],
  kinds: string[],
): Promise<RateVerdict> {
  for (const limit of limits) {
    const verdict = await checkRateLimit(limit, kinds);
    if (!verdict.allowed) return verdict;
  }
  return { allowed: true };
}

export async function checkRateLimit(limit: RateLimit, kinds: string[]): Promise<RateVerdict> {
  try {
    const supabase = await supabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      return { allowed: false, retryAfterMinutes: 0, message: "You're signed out." };
    }

    const used = await usedGenerations(kinds, limit.windowMinutes);

    // If the counter itself is broken, allow the request rather than blocking
    // all AI on an infrastructure hiccup. The reservation still fails closed.
    if (used === null) return { allowed: true };

    if (used >= limit.max) {
      return {
        allowed: false,
        retryAfterMinutes: limit.windowMinutes,
        message: overLimitMessage(limit),
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
  limits: readonly RateLimit[],
): Promise<ReserveOutcome> {
  const [allowance, ...burst] = limits;
  const refused = (error: string, windowMinutes = allowance.windowMinutes): ReserveOutcome => ({
    ok: false,
    error,
    retryAfterMinutes: windowMinutes,
  });

  try {
    /*
     * The burst ceilings, then the allowance.
     *
     * The allowance is the one that decides what somebody paid for, so it is
     * enforced by the statement that writes the ledger row — counted and
     * inserted under the same per-user lock, exactly. A burst ceiling is
     * abuse protection rather than a billing promise, and the reservation
     * function takes one window, so it is checked here instead: a burst of
     * genuinely simultaneous requests could put a couple of calls over it
     * before the first is recorded. That is the honest limit of this without
     * a second window in the database, and it is the right trade — the number
     * that must never be wrong is the one somebody bought.
     */
    for (const ceiling of burst) {
      const used = await usedGenerations(countKinds, ceiling.windowMinutes);
      if (used !== null && used >= ceiling.max) {
        return refused(overLimitMessage(ceiling), ceiling.windowMinutes);
      }
    }

    const supabase = await supabaseServer();
    const { data, error } = await supabase.rpc("captivate_reserve_generation", {
      p_kind: kind,
      p_count_kinds: countKinds,
      p_prompt: prompt.slice(0, 4000),
      p_presentation_id: presentationId,
      p_window_minutes: allowance.windowMinutes,
      p_max: allowance.max,
    });

    // Unlike the pre-filter, this one fails closed. The pre-filter can be
    // wrong in the safe direction — it only decides whether to reject early —
    // but if the reservation cannot be written there is nothing counting the
    // call, and an uncounted call is exactly what the limit exists to stop.
    if (error || !data) {
      return refused(
        error
          ? "Couldn't reserve an AI call just now. Nothing was spent — try again."
          : overLimitMessage(allowance),
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
 * a failure here loses cost detail rather than spend protection.
 *
 * This call carries the author's own JWT, which is also all a browser needs to
 * make it — and a zero-token failure is the one terminal state that stops
 * counting. So the database does not try to tell the two callers apart. It
 * relies on this one arriving *last*, after the model has answered: a
 * settlement recording spend is final, and one recording none can still be
 * corrected, so the truth written here supersedes anything forged before it.
 * See `0020_ledger_integrity.sql`.
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
