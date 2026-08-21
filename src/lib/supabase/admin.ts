import "server-only";

import { createClient } from "@supabase/supabase-js";
import { SUPABASE_URL } from "./config";
import type { Database } from "./database.types";

/**
 * Service-role client. Bypasses RLS, so it is used only where the server has
 * *already* established ownership by another means — currently nowhere in the
 * request path except signed-URL minting for objects proven to belong to the
 * caller.
 *
 * Never import this from a client component. `server-only` makes that a build
 * error rather than a silent key leak.
 */
export function supabaseAdmin() {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not set. This code path requires elevated access.",
    );
  }
  return createClient<Database>(SUPABASE_URL, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export const hasServiceRole = () => Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY);
