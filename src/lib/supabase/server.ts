import "server-only";

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { SUPABASE_ANON_KEY, SUPABASE_URL, assertSupabaseConfigured } from "./config";
import type { Database } from "./database.types";

/**
 * Request-scoped Supabase client for Server Components, Route Handlers and
 * Server Actions. It reads and refreshes the auth cookies, so every server-side
 * query runs as the signed-in user and is subject to RLS.
 */
export async function supabaseServer() {
  assertSupabaseConfigured();
  const cookieStore = await cookies();

  return createServerClient<Database>(SUPABASE_URL, SUPABASE_ANON_KEY, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where cookies are read-only.
          // The middleware refreshes the session instead, so this is safe.
        }
      },
    },
  });
}

/**
 * The signed-in user, verified against the auth server.
 *
 * Always prefer this over reading the session from the cookie: `getUser()`
 * validates the JWT, whereas a decoded cookie is attacker-controllable.
 */
export async function getCurrentUser() {
  const supabase = await supabaseServer();
  const { data, error } = await supabase.auth.getUser();
  if (error) return null;
  return data.user;
}

/** Throws a redirectable sentinel when no user is signed in. */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) throw new UnauthenticatedError();
  return user;
}

export class UnauthenticatedError extends Error {
  constructor() {
    super("Not signed in");
    this.name = "UnauthenticatedError";
  }
}
