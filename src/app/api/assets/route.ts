import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/** Lists the caller's assets for the media picker. RLS scopes the result. */
export async function GET(request: NextRequest) {
  const kind = request.nextUrl.searchParams.get("kind");
  const presentationId = request.nextUrl.searchParams.get("presentationId");

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ assets: [] }, { status: 401 });

  let query = supabase
    .from("assets")
    .select(
      "id, kind, mime_type, byte_size, width, height, alt_text, original_filename, created_at, presentation_id",
    )
    .order("created_at", { ascending: false })
    .limit(120);

  if (kind === "image" || kind === "video" || kind === "audio") query = query.eq("kind", kind);
  if (presentationId) query = query.eq("presentation_id", presentationId);

  const { data, error } = await query;
  if (error) return NextResponse.json({ assets: [], error: error.message }, { status: 500 });

  return NextResponse.json(
    {
      assets: (data ?? []).map((a) => ({
        id: a.id,
        kind: a.kind,
        mimeType: a.mime_type,
        byteSize: a.byte_size,
        width: a.width,
        height: a.height,
        alt: a.alt_text,
        filename: a.original_filename,
        createdAt: a.created_at,
        url: `/api/assets/${a.id}/content`,
      })),
    },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
