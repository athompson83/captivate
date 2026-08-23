import type { Metadata } from "next";
import { supabaseServer } from "@/lib/supabase/server";
import { AssetLibrary } from "@/components/dashboard/asset-library";

export const metadata: Metadata = { title: "Assets" };
export const dynamic = "force-dynamic";

export default async function AssetsPage() {
  const supabase = await supabaseServer();
  const { data } = await supabase
    .from("assets")
    .select("*, presentations(title)")
    .order("created_at", { ascending: false })
    .limit(200);

  const assets = (data ?? []).map((a) => {
    const row = a as unknown as {
      id: string;
      kind: "image" | "video" | "audio" | "file";
      mime_type: string;
      byte_size: number;
      width: number | null;
      height: number | null;
      alt_text: string;
      original_filename: string;
      created_at: string;
      presentations: { title: string } | null;
    };
    return {
      id: row.id,
      kind: row.kind,
      mimeType: row.mime_type,
      byteSize: Number(row.byte_size),
      width: row.width,
      height: row.height,
      alt: row.alt_text,
      filename: row.original_filename,
      createdAt: row.created_at,
      presentationTitle: row.presentations?.title ?? null,
      url: `/api/assets/${row.id}/content`,
    };
  });

  return <AssetLibrary assets={assets} />;
}
