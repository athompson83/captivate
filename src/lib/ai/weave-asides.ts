import { hotspotIndex } from "@/lib/schema/presentation";
import type { SceneContent } from "@/lib/schema/presentation";

/**
 * Weaving generated asides into the deck.
 *
 * An aside is depth on demand: a detail scene the presenter reaches by
 * clicking a hotspot, stepped over by next/previous, never counted in the
 * running order. The model proposes them per scene; this turns the proposals
 * into insert-ready rows and wires the hotspots — after ids exist, in the
 * same payload, so a dangling `targetSceneId` cannot be written.
 *
 * Pure on purpose. The id factory is injected so tests are deterministic and
 * the route keeps ownership of identity, exactly as `draftFromProposal` does
 * for the map.
 */

export interface GeneratedSceneDraft {
  momentId: string;
  title: string;
  content: SceneContent;
  speakerNotes: string;
  detail?: {
    /** What the clickable affordance is called. */
    label: string;
    title: string;
    content: SceneContent;
    speakerNotes: string;
  } | null;
}

export interface WovenRow {
  id: string;
  /** Null for a woven detail scene: it belongs to no moment. */
  momentId: string | null;
  /** The moment whose movement this row is filed under (its own, for mains). */
  filedUnder: string;
  title: string;
  content: SceneContent;
  speakerNotes: string;
  flowRole: "main" | "detail";
}

/** Bounded like every other generated array: an aside is a whole extra scene. */
const MAX_ASIDES = 6;

export function weaveAsides(scenes: GeneratedSceneDraft[], makeId: () => string): WovenRow[] {
  const rows: WovenRow[] = [];
  let woven = 0;

  for (const scene of scenes) {
    const parent: WovenRow = {
      id: makeId(),
      momentId: scene.momentId,
      filedUnder: scene.momentId,
      title: scene.title,
      content: scene.content,
      speakerNotes: scene.speakerNotes,
      flowRole: "main",
    };
    rows.push(parent);

    const detail = scene.detail;
    if (!detail || woven >= MAX_ASIDES) continue;

    const at = hotspotIndex(scene.content.elements);
    // No element can carry the dive — an unreachable detail scene is junk in
    // the deck, so the aside is dropped rather than woven.
    if (at === -1) continue;

    const detailId = makeId();
    const elements = [...scene.content.elements];
    elements[at] = {
      ...elements[at],
      hotspot: { targetSceneId: detailId, label: detail.label },
    };
    parent.content = { ...scene.content, elements };

    rows.push({
      id: detailId,
      momentId: null,
      filedUnder: scene.momentId,
      title: detail.title,
      content: detail.content,
      speakerNotes: detail.speakerNotes,
      flowRole: "detail",
    });
    woven += 1;
  }

  return rows;
}
