import { NextResponse, type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase/server";

/**
 * Cross-entity search for the command palette.
 *
 * Runs as the signed-in user, so RLS scopes every result to their own content;
 * there is no owner filter to forget here.
 */
export async function GET(request: NextRequest) {
  const q = (request.nextUrl.searchParams.get("q") ?? "").trim().slice(0, 120);
  if (q.length < 2) return NextResponse.json({ results: [] });

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ results: [] }, { status: 401 });

  // Neutralise PostgREST filter separators before interpolating into `or`.
  const safe = q.replace(/[,()\\*]/g, " ").trim();
  if (!safe) return NextResponse.json({ results: [] });

  const [presentations, notes] = await Promise.all([
    supabase
      .from("presentations")
      .select("id, title")
      .is("deleted_at", null)
      .or(`title.ilike.%${safe}%,description.ilike.%${safe}%`)
      .order("updated_at", { ascending: false })
      .limit(6),
    supabase
      .from("lecture_notes")
      .select("id, title, presentation_id")
      .or(`title.ilike.%${safe}%,body.ilike.%${safe}%`)
      .order("updated_at", { ascending: false })
      .limit(5),
  ]);

  const results = [
    ...(presentations.data ?? []).map((p) => ({
      id: p.id,
      title: p.title,
      kind: "presentation" as const,
      href: `/edit/${p.id}`,
    })),
    ...(notes.data ?? []).map((n) => ({
      id: n.id,
      title: n.title,
      kind: "note" as const,
      href: n.presentation_id ? `/notes?presentation=${n.presentation_id}&note=${n.id}` : `/notes?note=${n.id}`,
    })),
  ];

  return NextResponse.json(
    { results },
    { headers: { "Cache-Control": "private, no-store" } },
  );
}
