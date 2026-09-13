import "server-only";

import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { STORAGE_BUCKETS } from "@/lib/supabase/config";
import { parseSharedPayload, type SharedDeck } from "./shared-payload";

/**
 * Read side of share links.
 *
 * A share link is a capability: the uuid in the URL is the whole of the
 * authorisation, checked inside `captivate_shared_presentation` — the one
 * SECURITY DEFINER function that resolves tokens. Every table policy is
 * scoped to `authenticated`, so an anonymous visitor reads zero rows from the
 * tables themselves; what this function selects is exactly what a link-holder
 * can ever receive. It never selects speaker notes or the owner's identity;
 * this module's job is to fetch and validate, not to strip.
 */

export type { SharedDeck };

/** Loads the deck behind a share link. Null for a bad, revoked or stale link. */
export async function getSharedDeck(token: string): Promise<SharedDeck | null> {
  // Guard before the RPC: a malformed token is "no such deck", not a Postgres
  // cast error surfacing as a 500 on a public page.
  if (!z.string().uuid().safeParse(token).success) return null;

  const supabase = await supabaseServer();
  const { data, error } = await supabase.rpc("captivate_shared_presentation", {
    p_token: token,
  });
  if (error || data === null || data === undefined) return null;
  return parseSharedPayload(data);
}

/**
 * Where a shared asset's bytes may be read from for a moment.
 *
 * The share card's room source (`roomForCard`): the same resolver the asset
 * route falls back to for a link-holder, `captivate_shared_asset`, which
 * answers only while the deck is shared right now, and a signed address on
 * the deck's own storage that lasts a minute. Nothing here reads an address
 * an author typed.
 */
export async function signSharedAsset(
  assetId: string,
): Promise<{ url: string; type: string } | null> {
  if (!z.string().uuid().safeParse(assetId).success) return null;
  const supabase = await supabaseServer();
  const { data: shared } = await supabase.rpc("captivate_shared_asset", { p_asset_id: assetId });
  const row = shared?.[0];
  if (!row?.storage_path) return null;
  const { data: signed, error } = await supabase.storage
    .from(STORAGE_BUCKETS.assets)
    .createSignedUrl(row.storage_path, 60);
  if (error || !signed) return null;
  return { url: signed.signedUrl, type: row.mime_type ?? "" };
}
