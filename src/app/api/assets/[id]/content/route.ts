import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";
import { STORAGE_BUCKETS, SIGNED_URL_TTL_SECONDS } from "@/lib/supabase/config";

/**
 * Serves a private asset.
 *
 * Scene content stores `/api/assets/<id>/content`, which never expires. This
 * route resolves it to a short-lived signed URL at request time, after RLS has
 * confirmed the asset belongs to the caller. An id belonging to someone else
 * returns 404 — the same response as an id that does not exist, so the route
 * cannot be used to probe for other users' assets.
 *
 * A shared deck can reference the same URLs, and a link-holder has no
 * session — so an unauthenticated caller falls back to
 * `captivate_shared_asset`, which resolves the asset only if it belongs to a
 * presentation that is *currently* shared. Revoking the share removes both
 * paths in the same instant.
 */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuid.test(id)) return new NextResponse("Not found", { status: 404 });

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let storagePath: string | null = null;
  if (user) {
    const { data: asset } = await supabase
      .from("assets")
      .select("storage_path")
      .eq("id", id)
      .maybeSingle();
    storagePath = asset?.storage_path ?? null;
  } else {
    const { data: shared } = await supabase.rpc("captivate_shared_asset", { p_asset_id: id });
    storagePath = shared?.[0]?.storage_path ?? null;
  }

  if (!storagePath) return new NextResponse("Not found", { status: 404 });

  const { data: signed, error } = await supabase.storage
    .from(STORAGE_BUCKETS.assets)
    .createSignedUrl(storagePath, SIGNED_URL_TTL_SECONDS);

  if (error || !signed) return new NextResponse("Not found", { status: 404 });

  return NextResponse.redirect(signed.signedUrl, {
    status: 307,
    headers: {
      // Private and short so a revoked asset stops resolving quickly, but long
      // enough that a deck with many images does not re-sign on every scene.
      "Cache-Control": "private, max-age=300",
    },
  });
}
