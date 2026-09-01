import { describe, expect, it, vi } from "vitest";

/**
 * A recovery flow is a sign-up with the identity already known.
 *
 * `passwordProblem` refuses a password that is really the email address or the
 * display name on the same form, because both halves of a login in one place
 * is not two secrets. Sign-up passes it that context. Recovery did not — it
 * called the same function with the password alone, so both identity checks
 * silently did nothing and `alexsmith99` was accepted for
 * `alex.smith@example.com` on the one screen where a person is most likely to
 * reach for a password they have already had trouble with.
 *
 * The comment above the call said "the same policy as sign-up" while the call
 * made that false, which is the reason this test reads the answer rather than
 * the source.
 */

const updateUser = vi.fn(async () => ({ error: null }));

const user = { id: "user-1", email: "alex.smith@example.com" };
const profile = { display_name: "Wilhelmina" };

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({
    auth: { getUser: async () => ({ data: { user } }), updateUser },
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: profile }) }) }),
    }),
  }),
}));

/** The form posts both fields; every case here sends a matching confirmation. */
function submit(password: string) {
  const body = new FormData();
  body.set("password", password);
  body.set("confirm", password);
  return body;
}

describe("setting a new password from a recovery link", () => {
  it("refuses one that is really the account's email address", async () => {
    const { updatePassword } = await import("@/lib/auth/actions");
    const result = await updatePassword(null, submit("alexsmith99"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/email/i);
    expect(result.field).toBe("password");
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("refuses one that is really the account's name", async () => {
    const { updatePassword } = await import("@/lib/auth/actions");
    const result = await updatePassword(null, submit("Wilhelmina-1"));

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/name/i);
  });

  it("accepts an unrelated one, so the policy is not simply refusing everything", async () => {
    const { updatePassword } = await import("@/lib/auth/actions");
    await updatePassword(null, submit("thimble-rafter-quench"));

    expect(updateUser).toHaveBeenCalledWith({ password: "thimble-rafter-quench" });
  });
});
