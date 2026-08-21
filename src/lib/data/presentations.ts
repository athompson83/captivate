import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import {
  PRESENTATION_SCHEMA_VERSION,
  parseSceneContent,
  type PresentationDocument,
  type PresentationRecord,
  type Scene,
  type Section,
} from "@/lib/schema/presentation";
import type { PresentationRow, SceneRow, SectionRow } from "@/lib/supabase/database.types";

/**
 * Read-side data access for presentations.
 *
 * Every query below runs through the request-scoped client, so RLS is the
 * authorisation boundary. These helpers never take an owner id from the
 * caller — supplying one would be exactly the IDOR shape RLS exists to stop.
 */

export function toPresentationRecord(row: PresentationRow): PresentationRecord {
  return {
    id: row.id,
    ownerId: row.owner_id,
    folderId: row.folder_id,
    title: row.title,
    description: row.description,
    themeId: row.theme_id,
    themeOverrides: (row.theme_overrides as Record<string, unknown> | null) ?? null,
    aspectRatio: row.aspect_ratio,
    tags: row.tags ?? [],
    isFavorite: row.is_favorite,
    thumbnailUrl: row.thumbnail_url,
    schemaVersion: row.schema_version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastOpenedAt: row.last_opened_at,
  };
}

export function toSection(row: SectionRow): Section {
  return {
    id: row.id,
    presentationId: row.presentation_id,
    title: row.title,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toScene(row: SceneRow): { scene: Scene; recovered: boolean } {
  const { content, recovered } = parseSceneContent(row.content);
  return {
    scene: {
      id: row.id,
      presentationId: row.presentation_id,
      sectionId: row.section_id,
      position: row.position,
      title: row.title,
      content,
      speakerNotes: row.speaker_notes,
      durationSeconds: row.duration_seconds,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    recovered,
  };
}

export interface PresentationSummary extends PresentationRecord {
  sceneCount: number;
  folderName: string | null;
}

export interface ListOptions {
  search?: string;
  folderId?: string | null;
  favoritesOnly?: boolean;
  tag?: string;
  sort?: "recent" | "opened" | "title" | "created";
  limit?: number;
}

export async function listPresentations(opts: ListOptions = {}): Promise<PresentationSummary[]> {
  const supabase = await supabaseServer();

  let query = supabase
    .from("presentations")
    .select("*, folders(name), scenes(count)")
    .is("deleted_at", null);

  if (opts.search?.trim()) {
    // Escape PostgREST's `or` filter separators so a comma or paren in the
    // search box cannot alter the filter expression.
    const term = opts.search
      .trim()
      .replace(/[,()\\]/g, " ")
      .slice(0, 120);
    if (term.trim()) {
      query = query.or(`title.ilike.%${term}%,description.ilike.%${term}%`);
    }
  }
  if (opts.folderId !== undefined) {
    query =
      opts.folderId === null ? query.is("folder_id", null) : query.eq("folder_id", opts.folderId);
  }
  if (opts.favoritesOnly) query = query.eq("is_favorite", true);
  if (opts.tag) query = query.contains("tags", [opts.tag]);

  switch (opts.sort ?? "recent") {
    case "opened":
      query = query.order("last_opened_at", { ascending: false, nullsFirst: false });
      break;
    case "title":
      query = query.order("title", { ascending: true });
      break;
    case "created":
      query = query.order("created_at", { ascending: false });
      break;
    default:
      query = query.order("updated_at", { ascending: false });
  }

  const { data, error } = await query.limit(opts.limit ?? 60);
  if (error) throw new Error(`Could not load presentations: ${error.message}`);

  type Joined = PresentationRow & {
    folders: { name: string } | null;
    scenes: { count: number }[] | null;
  };

  return (data as unknown as Joined[]).map((row) => ({
    ...toPresentationRecord(row),
    sceneCount: row.scenes?.[0]?.count ?? 0,
    folderName: row.folders?.name ?? null,
  }));
}

/** Loads a full deck. Returns null when the id does not exist *or* is not ours. */
export async function getPresentationDocument(
  id: string,
): Promise<(PresentationDocument & { recoveredScenes: string[] }) | null> {
  const supabase = await supabaseServer();

  const [presentationRes, sectionsRes, scenesRes] = await Promise.all([
    supabase.from("presentations").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
    supabase.from("sections").select("*").eq("presentation_id", id).order("position"),
    supabase.from("scenes").select("*").eq("presentation_id", id).order("position"),
  ]);

  if (presentationRes.error || !presentationRes.data) return null;
  if (sectionsRes.error) throw new Error(sectionsRes.error.message);
  if (scenesRes.error) throw new Error(scenesRes.error.message);

  const recoveredScenes: string[] = [];
  const scenes = (scenesRes.data as SceneRow[]).map((row) => {
    const { scene, recovered } = toScene(row);
    if (recovered) recoveredScenes.push(scene.id);
    return scene;
  });

  return {
    presentation: toPresentationRecord(presentationRes.data as PresentationRow),
    sections: (sectionsRes.data as SectionRow[]).map(toSection),
    scenes,
    recoveredScenes,
  };
}

/** Lightweight header used by pages that do not need the whole deck. */
export async function getPresentationMeta(id: string): Promise<PresentationRecord | null> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("presentations")
    .select("*")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (error || !data) return null;
  return toPresentationRecord(data as PresentationRow);
}

export async function listFolders() {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("folders")
    .select("*, presentations(count)")
    .order("position")
    .order("created_at");
  if (error) throw new Error(error.message);

  return (data ?? []).map((f) => {
    const row = f as unknown as {
      id: string;
      name: string;
      color: string;
      position: number;
      presentations: { count: number }[] | null;
    };
    return {
      id: row.id,
      name: row.name,
      color: row.color,
      position: row.position,
      count: row.presentations?.[0]?.count ?? 0,
    };
  });
}

export async function listAllTags(): Promise<{ tag: string; count: number }[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("presentations")
    .select("tags")
    .is("deleted_at", null);
  if (error) return [];

  const counts = new Map<string, number>();
  for (const row of data ?? []) {
    for (const tag of (row as { tags: string[] }).tags ?? []) {
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return [...counts.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

export async function listTrashed(): Promise<PresentationSummary[]> {
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("presentations")
    .select("*, folders(name), scenes(count)")
    .not("deleted_at", "is", null)
    .order("deleted_at", { ascending: false });
  if (error) throw new Error(error.message);

  type Joined = PresentationRow & {
    folders: { name: string } | null;
    scenes: { count: number }[] | null;
  };
  return (data as unknown as Joined[]).map((row) => ({
    ...toPresentationRecord(row),
    sceneCount: row.scenes?.[0]?.count ?? 0,
    folderName: row.folders?.name ?? null,
  }));
}

export { PRESENTATION_SCHEMA_VERSION };
