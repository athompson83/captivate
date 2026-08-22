import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import type { AvailableEvidence } from "@/lib/narrative/generate";

/**
 * What this user can ground a claim in.
 *
 * Assets and lecture notes are the workspace's real evidence entities, so
 * evidence references point at those rather than at a parallel source system
 * that would immediately drift out of step with them.
 *
 * Read server-side, through the request-scoped client, so RLS decides what is
 * visible. The list is then the only thing a generated map may cite: anything
 * else the model returns is discarded rather than trusted.
 */
export async function listEvidence(presentationId?: string): Promise<AvailableEvidence[]> {
  const supabase = await supabaseServer();

  const [assets, notes] = await Promise.all([
    supabase
      .from("assets")
      .select("id, original_filename, alt_text, kind")
      .order("created_at", { ascending: false })
      .limit(60),
    supabase
      .from("lecture_notes")
      .select("id, title, presentation_id")
      .order("updated_at", { ascending: false })
      .limit(60),
  ]);

  const out: AvailableEvidence[] = [];

  for (const asset of assets.data ?? []) {
    out.push({
      kind: "asset",
      id: asset.id,
      // Alt text describes what the picture is *doing*, which is what makes it
      // useful to a model choosing whether it grounds a claim.
      label: asset.alt_text?.trim() || asset.original_filename,
    });
  }

  for (const note of notes.data ?? []) {
    // Notes attached to this presentation lead: they are the material the
    // author has already decided belongs with it.
    const own = presentationId && note.presentation_id === presentationId;
    const entry = { kind: "note" as const, id: note.id, label: note.title || "Untitled note" };
    if (own) out.unshift(entry);
    else out.push(entry);
  }

  return out;
}
