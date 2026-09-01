"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { headers } from "next/headers";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Auth server actions.
 *
 * Every action validates its input with Zod before touching Supabase, and
 * returns a discriminated result rather than throwing, so forms can render
 * field-level errors without a client-side error boundary.
 */

export type ActionResult =
  { ok: true; message?: string } | { ok: false; error: string; field?: string };

import { PASSWORD_MAX, passwordProblem } from "./password";

const Email = z.string().trim().toLowerCase().email("Enter a valid email address").max(320);
/**
 * Shape only. Whether the password is a *good* one is decided by
 * `passwordProblem`, which needs the email and name from the same form to say
 * so — a schema on one field cannot see the other two.
 */
const Password = z
  .string()
  .min(1, "Choose a password")
  .max(PASSWORD_MAX, "That password is too long");

/** Only ever redirect to a same-origin path, never to an attacker-supplied URL. */
function safeNext(next: unknown): string {
  if (typeof next !== "string") return "/home";
  if (!next.startsWith("/") || next.startsWith("//")) return "/home";
  return next;
}

/**
 * Where this deployment lives, for links sent by email.
 *
 * `x-forwarded-host` is whatever the client sent. A confirmation or recovery
 * link carries a one-time credential, so building one from a request header
 * means anybody can post the reset form with `Host: attacker.example` and have
 * the account's owner emailed a genuine Supabase link that hands the code
 * somewhere else. Supabase's redirect allowlist is a backstop, and a backstop
 * configured elsewhere is not a reason to aim at it.
 *
 * So the header fallback survives only where nothing is at stake — a local
 * dev server, where there is no attacker and no `NEXT_PUBLIC_SITE_URL`. In
 * production the deployment says where it is or no link is sent at all. Naming
 * the variable in the error makes that a configuration mistake someone fixes
 * in a minute; the alternative is a poisoned link nobody ever sees.
 */
async function origin(): Promise<string | null> {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL;
  if (explicit) return explicit.replace(/\/$/, "");
  if (process.env.NODE_ENV === "production") return null;

  const h = await headers();
  const host = h.get("x-forwarded-host") ?? h.get("host");
  return host ? `${h.get("x-forwarded-proto") ?? "http"}://${host}` : null;
}

const NO_ORIGIN =
  "This deployment has no NEXT_PUBLIC_SITE_URL set, so the link in the email would point nowhere reliable. Set it and try again.";

export async function signIn(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = z
    .object({ email: Email, password: z.string().min(1, "Enter your password") })
    .safeParse({ email: formData.get("email"), password: formData.get("password") });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0]) };
  }

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithPassword(parsed.data);

  if (error) {
    // Deliberately generic: distinguishing "no such user" from "wrong password"
    // would let anyone enumerate registered email addresses.
    return { ok: false, error: "That email and password combination doesn't match an account." };
  }

  revalidatePath("/", "layout");
  redirect(safeNext(formData.get("next")));
}

export async function signUp(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = z
    .object({
      email: Email,
      password: Password,
      displayName: z.string().trim().min(1, "Tell us what to call you").max(80),
    })
    .safeParse({
      email: formData.get("email"),
      password: formData.get("password"),
      displayName: formData.get("displayName"),
    });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0]) };
  }

  // Checked here, on the server, rather than only in the form: the browser is
  // where the guess is typed, not where it is decided.
  const weak = passwordProblem(parsed.data.password, {
    email: parsed.data.email,
    displayName: parsed.data.displayName,
  });
  if (weak) return { ok: false, error: weak, field: "password" };

  const site = await origin();
  if (!site) return { ok: false, error: NO_ORIGIN };

  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { display_name: parsed.data.displayName },
      emailRedirectTo: `${site}/auth/callback?next=/home`,
    },
  });

  if (error) {
    return { ok: false, error: error.message };
  }

  // When email confirmation is enabled Supabase returns a user with no session.
  if (data.user && !data.session) {
    return {
      ok: true,
      message: "Check your inbox — we've sent a link to confirm your email address.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/home?welcome=1");
}

export async function requestPasswordReset(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = Email.safeParse(formData.get("email"));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0].message, field: "email" };

  const site = await origin();
  if (!site) return { ok: false, error: NO_ORIGIN };

  const supabase = await supabaseServer();
  await supabase.auth.resetPasswordForEmail(parsed.data, {
    redirectTo: `${site}/auth/callback?next=/update-password`,
  });

  // Always report success — a differing response would leak which addresses
  // have accounts.
  return {
    ok: true,
    message: "If that address has an account, a reset link is on its way.",
  };
}

export async function updatePassword(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = z
    .object({ password: Password, confirm: z.string() })
    .refine((v) => v.password === v.confirm, {
      message: "Those passwords don't match",
      path: ["confirm"],
    })
    .safeParse({ password: formData.get("password"), confirm: formData.get("confirm") });

  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ok: false, error: issue.message, field: String(issue.path[0]) };
  }

  const supabase = await supabaseServer();

  // The identity has to be read before the policy runs, not after. A recovery
  // link signs the user in, so their email and name are available here — and
  // without them `passwordProblem` skips both of its identity checks, which
  // would let recovery accept `alexsmith99` for `alex.smith@example.com` while
  // sign-up refuses it. Same policy means the same context.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return { ok: false, error: "That reset link has expired. Ask for a new one." };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .maybeSingle();

  // A recovery flow is exactly where someone reaches for the password they
  // already had trouble with, so it gets the same policy as sign-up.
  const weak = passwordProblem(parsed.data.password, {
    email: user.email ?? undefined,
    displayName: profile?.display_name ?? undefined,
  });
  if (weak) return { ok: false, error: weak, field: "password" };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  redirect("/home?password=updated");
}

export async function signOut() {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/sign-in");
}

export async function updateProfile(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const parsed = z
    .object({ displayName: z.string().trim().min(1, "Name can't be empty").max(80) })
    .safeParse({ displayName: formData.get("displayName") });

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0].message, field: "displayName" };
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out. Sign in again to continue." };

  const { error } = await supabase
    .from("profiles")
    .update({ display_name: parsed.data.displayName })
    .eq("id", user.id);

  if (error) return { ok: false, error: error.message };

  revalidatePath("/settings");
  return { ok: true, message: "Profile updated." };
}
