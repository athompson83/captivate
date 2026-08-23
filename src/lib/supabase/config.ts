/**
 * Supabase configuration, resolved once and validated loudly.
 *
 * Only the URL and the publishable (anon) key are ever exposed to the browser.
 * The service-role key is read exclusively from server modules and is never
 * imported into a client component.
 */

export const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
export const SUPABASE_ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? "";

/**
 * True when the app has enough configuration to talk to Supabase at all.
 * The UI uses this to render an actionable setup screen instead of throwing
 * an opaque runtime error on every page.
 */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_ANON_KEY);

export function assertSupabaseConfigured(): void {
  if (!isSupabaseConfigured) {
    throw new Error(
      "Supabase is not configured. Set NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY. See docs/DEPLOYMENT.md.",
    );
  }
}

export const STORAGE_BUCKETS = {
  assets: "assets",
  recordings: "recordings",
  thumbnails: "thumbnails",
} as const;

/** Signed URLs are short-lived; the client re-requests them as needed. */
export const SIGNED_URL_TTL_SECONDS = 60 * 60;
