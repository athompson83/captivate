import "server-only";

import { supabaseServer } from "@/lib/supabase/server";
import { logFailureSampled } from "@/lib/observability";
import {
  JourneyConfig,
  PRESENTATION_SCHEMA_VERSION,
  ScenePlacement,
  parseSceneContent,
  repairDanglingHotspots,
  type PresentationDocument,
  type PresentationRecord,
  type Scene,
  type SceneContent,
  type Section,
} from "@/lib/schema/presentation";
import { z } from "zod";
import { EvidenceRef, NarrativeRole, VisualIntent, type Moment } from "@/lib/schema/narrative";
import type {
  MomentRow,
  PresentationRow,
  SceneRow,
  SectionRow,
} from "@/lib/supabase/database.types";

/**
 * Read-side data access for presentations.
 *
 * Every query below runs through the request-scoped client, so RLS is the
 * authorisation boundary. These helpers never take an owner id from the
 * caller — supplying one would be exactly the IDOR shape RLS exists to stop.
 */

/**
 * Journey config and scene placement are validated like any other stored
 * content: a row written by an older build, or by hand, must not be able to
 * hand the camera a NaN and freeze a presentation mid-flight. Both fall back
 * rather than throw, because losing the geometry is recoverable and losing the
 * whole deck is not.
 */
function parseJourney(raw: unknown) {
  const parsed = JourneyConfig.safeParse(raw ?? {});
  return parsed.success ? parsed.data : JourneyConfig.parse({});
}

function parsePlacement(raw: unknown) {
  if (raw === null || raw === undefined) return null;
  const parsed = ScenePlacement.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

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
    journey: parseJourney(row.journey),
    targetSeconds: row.target_seconds ?? 0,
    tags: row.tags ?? [],
    isFavorite: row.is_favorite,
    thumbnailUrl: row.thumbnail_url,
    schemaVersion: row.schema_version,
    shareToken: row.share_token,
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
    label: row.label ?? "",
    purpose: row.purpose ?? "",
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * A stored moment.
 *
 * Role, visual intent and evidence are validated rather than trusted: a row
 * written by an older build, or by hand, must not be able to put an unknown
 * role into the map and break the generator downstream. Each falls back to a
 * safe value rather than discarding the moment, because losing one beat of an
 * argument to a bad enum is not a trade worth making.
 */
export function toMoment(row: MomentRow): Moment {
  const role = NarrativeRole.safeParse(row.role);
  const intent = VisualIntent.safeParse(row.visual_intent);
  const evidence = z.array(EvidenceRef).safeParse(row.evidence ?? []);

  return {
    id: row.id,
    presentationId: row.presentation_id,
    movementId: row.movement_id,
    title: row.title,
    role: role.success ? role.data : "claim",
    purpose: row.purpose,
    takeaway: row.takeaway,
    estimatedSeconds: row.estimated_seconds,
    evidence: evidence.success ? evidence.data : [],
    visualIntent: intent.success ? intent.data : "auto",
    instructions: row.instructions,
    locked: row.locked,
    position: row.position,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toScene(row: SceneRow): { scene: Scene; recovered: boolean } {
  const { content, recovered } = parseSceneContent(row.content, row.id);
  return {
    scene: {
      id: row.id,
      presentationId: row.presentation_id,
      sectionId: row.section_id,
      position: row.position,
      title: row.title,
      content,
      placement: parsePlacement(row.placement),
      momentId: row.moment_id,
      speakerNotes: row.speaker_notes,
      durationSeconds: row.duration_seconds,
      // Rows written before 0009 have no column at all through a stale client;
      // "main" keeps those scenes in the running order rather than hiding them.
      flowRole: row.flow_role ?? "main",
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

/**
 * Every deck's first scene, for the dashboard's card previews.
 *
 * One query for all of them, which is what makes the failure so visible: the
 * home page fires four concurrent reads, and in the seconds after sign-in
 * exactly one of them can come back 401 while the others succeed — the same
 * race `listPresentations` documents below. When the unlucky one was this
 * query, every thumbnail on the page went blank at once, and nothing said so.
 * `preview === null` renders the theme's canvas colour, which is
 * indistinguishable from a deck whose first scene really is a bare background.
 *
 * Two copies of this used to live in the two dashboard routes, both discarding
 * the error with `const { data } = await …`. So the retry that already existed
 * for the deck list did not cover the thumbnails, and a transient blip looked
 * exactly like "Captivate lost my slides".
 */
export async function fetchFirstScenes(limit = 120): Promise<Map<string, SceneContent>> {
  const supabase = await supabaseServer();

  // Built inside the closure, for the reason `readWithRetry` explains: a PostgREST
  // builder is a one-shot thenable, and a retry that re-awaits the same object
  // replays the first failure without making a request.
  const build = () =>
    supabase.from("scenes").select("presentation_id, content").eq("position", 0).limit(limit);

  const { data, error } = await readWithRetry(build);

  // Logged rather than thrown. A dashboard with no thumbnails is worth far
  // less than a dashboard that will not load, so this degrades — but it
  // degrades *loudly*, which is the part that was missing.
  if (error) {
    logFailureSampled("dashboard.previews", new Error(error.message));
    return new Map();
  }

  const map = new Map<string, SceneContent>();
  for (const row of data ?? []) {
    const { content, recovered } = parseSceneContent(row.content);
    // A scene that had to be salvaged is a different thing from one that is
    // genuinely empty, and the card cannot tell them apart — both paint the
    // bare theme colour.
    if (recovered)
      logFailureSampled("dashboard.previews.recovered", new Error(row.presentation_id));
    map.set(row.presentation_id, content);
  }
  return map;
}

export async function listPresentations(opts: ListOptions = {}): Promise<PresentationSummary[]> {
  const supabase = await supabaseServer();

  /*
   * Built inside a factory, not once outside it.
   *
   * `readWithRetry` retries by calling this again, and that only issues a second
   * request if a second *builder* is made. A PostgREST builder is a one-shot
   * thenable: re-awaiting one that has already resolved hands back the same
   * cached result without touching the network. Constructing the query outside
   * the closure and only calling `.limit()` inside it looked like a fresh
   * request and was not, so the retry silently replayed the first failure.
   *
   * That is not theoretical. Signing in on production produced four concurrent
   * reads, of which exactly one — this one — came back 401 while the other
   * three succeeded twenty milliseconds either side of it. The edge log shows
   * no second request for it: the retry ran, re-awaited the dead builder, and
   * got the same 401 back. Because this is the only read on the home page that
   * throws on error, the whole page died and the author was told their work
   * could not be read.
   */
  const build = () => {
    let query = supabase
      .from("presentations")
      .select("*, folders(name), scenes(count)")
      // The count a reader cares about is how long the talk is, and an aside is
      // not a beat of it — it is reached by clicking a hotspot and may never be
      // opened at all. Filtering the embedded rows rather than the parents, so a
      // deck that is *only* asides still lists, showing none.
      .eq("scenes.flow_role", "main")
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

    return query.limit(opts.limit ?? 60);
  };

  const { data, error } = await readWithRetry(build);
  if (error) throw new Error(`Could not load presentations: ${error.message}`);
  // A read that reports neither rows nor an error should not be possible, and
  // `.map` on null is a TypeError with a stack that points at this file rather
  // than at the read — which is the least useful thing a page can put in front
  // of somebody whose work did not appear.
  if (!data)
    throw new Error("Could not load presentations: the read returned no rows and no error.");

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

/**
 * The pauses before each retry, and so how many there are.
 *
 * One retry at 300ms was the first version of this, and production showed it
 * was not enough. The edge log for a dead home page: a password grant at
 * 19:55:43.7, and at 19:55:45.3 four concurrent reads on the new session of
 * which exactly one came back 401 — 1.6 seconds after the token was minted,
 * with the three beside it carrying the same token and succeeding. The author's
 * own retry, forty seconds later, worked first time.
 *
 * So the window this is absorbing is longer than one short pause: a token is
 * briefly newer than the thing being asked to trust it. A second retry a second
 * later covers it, and costs nothing on the overwhelming majority of reads that
 * never fail at all.
 */
const RETRY_PAUSES_MS = [300, 900];

/**
 * Runs a read, and runs it again before giving up.
 *
 * The moment this exists for is the redirect straight after sign-in: the
 * session cookie is milliseconds old, the serverless function may be cold,
 * and a single refused or dropped PostgREST request at that instant was
 * reaching the page as a thrown error — a full-page "This page didn't load"
 * over a database that was perfectly healthy a moment later. A database that is
 * genuinely down still fails, into the same error boundary, with a Try again
 * that now means something.
 *
 * Takes a closure rather than a builder because a PostgREST builder is a
 * one-shot thenable — re-awaiting the same object is not a fresh request.
 */
export async function readWithRetry<T extends { error: { message: string } | null }>(
  run: () => PromiseLike<T>,
): Promise<T> {
  let attempt = run();
  let result = await attempt;
  if (!result.error) return result;

  for (const pause of RETRY_PAUSES_MS) {
    await new Promise((resolve) => setTimeout(resolve, pause));
    const nextAttempt = run();

    /*
     * The closure has to build a new query, not reach for one built outside it.
     *
     * A PostgREST builder is a one-shot thenable: awaiting a settled one returns
     * its cached result without a request. A caller who closes over a builder
     * instead of constructing one therefore gets a retry that replays the first
     * failure, silently — which is exactly what shipped, and what turned a single
     * 401 in the seconds after sign-in into a dead home page.
     *
     * The comment above was already there and did not prevent it, so this checks
     * instead. Identical references mean no second request was made, and saying
     * so is strictly more useful than surfacing the first error twice: the read
     * had already failed, and this at least names why the retry could not help.
     */
    if (nextAttempt === attempt) {
      throw new Error(
        "readWithRetry was given a closure that returns the same query object twice, so the " +
          "retry made no request. Build the query inside the closure.",
      );
    }

    attempt = nextAttempt;
    result = await attempt;
    if (!result.error) return result;
  }

  // Every attempt failed. The callers do different things with that — one
  // throws into the error boundary, another degrades to no thumbnails — but
  // none of them can say how many times it was tried, and "we tried three
  // times over a second and a half" is the difference between a blip and an
  // outage when somebody is reading the log afterwards.
  logFailureSampled(
    "read.exhausted",
    new Error(`${RETRY_PAUSES_MS.length + 1} attempts: ${result.error?.message}`),
  );
  return result;
}

/**
 * Exposed for the one test that cannot reach this through a public function:
 * that a closure returning the same object twice is rejected rather than
 * silently treated as a retry.
 */
export const __readWithRetryForTests = readWithRetry;

/** Loads a full deck. Returns null when the id does not exist *or* is not ours. */
export async function getPresentationDocument(
  id: string,
): Promise<(PresentationDocument & { recoveredScenes: string[] }) | null> {
  const supabase = await supabaseServer();

  const [presentationRes, sectionsRes, scenesRes, momentsRes] = await Promise.all([
    readWithRetry(() =>
      supabase.from("presentations").select("*").eq("id", id).is("deleted_at", null).maybeSingle(),
    ),
    readWithRetry(() =>
      supabase.from("sections").select("*").eq("presentation_id", id).order("position"),
    ),
    readWithRetry(() =>
      supabase.from("scenes").select("*").eq("presentation_id", id).order("position"),
    ),
    readWithRetry(() =>
      supabase.from("moments").select("*").eq("presentation_id", id).order("position"),
    ),
  ]);

  if (presentationRes.error || !presentationRes.data) return null;
  if (sectionsRes.error) throw new Error(sectionsRes.error.message);
  if (scenesRes.error) throw new Error(scenesRes.error.message);
  if (momentsRes.error) throw new Error(momentsRes.error.message);

  const recoveredScenes: string[] = [];
  const parsed = (scenesRes.data as SceneRow[]).map((row) => {
    const { scene, recovered } = toScene(row);
    if (recovered) recoveredScenes.push(scene.id);
    return scene;
  });

  // Only here is the whole deck in hand, so only here can a hotspot pointing at
  // a deleted scene be found. Report it alongside the salvaged scenes: the
  // author should know a link was cleared rather than discover it on stage.
  const { scenes, repaired } = repairDanglingHotspots(parsed);
  for (const id of repaired) if (!recoveredScenes.includes(id)) recoveredScenes.push(id);

  return {
    presentation: toPresentationRecord(presentationRes.data as PresentationRow),
    sections: (sectionsRes.data as SectionRow[]).map(toSection),
    scenes,
    moments: (momentsRes.data as MomentRow[]).map(toMoment),
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
  const { data, error } = await readWithRetry(() =>
    supabase
      .from("folders")
      .select("*, presentations(count)")
      .order("position")
      .order("created_at"),
  );
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
  const { data, error } = await readWithRetry(() =>
    supabase
      .from("presentations")
      .select("*, folders(name), scenes(count)")
      // The count a reader cares about is how long the talk is, and an aside
      // is not a beat of it — it is reached by clicking a hotspot and may
      // never be opened at all. Filtering the embedded rows rather than the
      // parents, so a deck that is *only* asides still lists, showing none.
      .eq("scenes.flow_role", "main")
      .not("deleted_at", "is", null)
      .order("deleted_at", { ascending: false }),
  );
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
