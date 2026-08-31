import "server-only";

import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUser } from "@/lib/supabase/server";
import { checkRateLimit } from "./rate-limit";
import { limitForCaller } from "@/lib/billing/entitlement";
import { BUDGET_KINDS, type BudgetGroup } from "@/lib/billing/plans";

/**
 * Shared guard for every AI route: authenticated, rate limited, and validated
 * before a single token is spent.
 *
 * The budget comes from the caller's plan rather than a fixed constant, so a
 * route says which *kind* of work it is doing and the plan decides how much of
 * it is allowed.
 *
 * A route names its group and nothing else. It used to name the ledger kinds
 * too, and one of them named the wrong ones: the create route charged the deck
 * budget for `map` rows, so drafting an argument twice spent a deck an author
 * had not created.
 */
export async function guard<T>(
  request: Request,
  schema: z.ZodType<T>,
  group: BudgetGroup,
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

  const verdict = await checkRateLimit(await limitForCaller(group), BUDGET_KINDS[group]);
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
