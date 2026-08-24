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
      source: "upload" | "stock" | "generated" | null;
      creator_name: string | null;
      creator_page_url: string | null;
      original_page_url: string | null;
      license_ref: string | null;
      provider: string | null;
      model: string | null;
      prompt: string | null;
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
      /*
       * Where this image came from.
       *
       * The picker tells people "the photographer is credited in the asset
       * library", and nothing in the asset library credited anybody — the
       * columns were written and never read. A licence obligation that exists
       * only in the database is not discharged.
       */
      source: row.source ?? "upload",
      creatorName: row.creator_name,
      creatorPageUrl: row.creator_page_url,
      originalPageUrl: row.original_page_url,
      licenseRef: row.license_ref,
      provider: row.provider,
      model: row.model,
      prompt: row.prompt,
      presentationTitle: row.presentations?.title ?? null,
      url: `/api/assets/${row.id}/content`,
    };
  });

  return <AssetLibrary assets={assets} />;
}
