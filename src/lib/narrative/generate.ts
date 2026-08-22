import type { Section } from "@/lib/schema/presentation";
import {
  distributeSeconds,
  type EvidenceRef,
  type Moment,
  type NarrativeRole,
  type VisualIntent,
} from "@/lib/schema/narrative";
import type { ProposedMap } from "@/lib/ai/schemas";

/**
 * Turning a proposal into a map.
 *
 * The model proposes structure; this owns identity, time and truth. Three
 * things happen here that must not happen in a prompt:
 *
 *  - **Ids are assigned by the application.** A regenerated proposal merges
 *    into the existing map rather than replacing it wholesale, so scenes and
 *    (later) note anchors keep pointing at the moments they always did.
 *  - **Evidence is verified.** A proposal may only reference sources the
 *    workspace actually holds; anything else is dropped rather than trusted,
 *    which is what stops a model inventing a citation by naming a plausible id.
 *  - **Time is distributed by weight**, so the proportions the model proposed
 *    hold at whatever duration the user asked for, and the totals add up.
 */

export interface AvailableEvidence {
  kind: EvidenceRef["kind"];
  id: string;
  label: string;
}

export interface MapDraft {
  movements: Section[];
  moments: Moment[];
  approach: string;
  suggestedThemeId: string;
}

/** Existing moments that a regeneration must preserve, keyed for lookup. */
export interface MergeContext {
  /** Moments the author locked. Never replaced. */
  locked: Moment[];
  /** Existing movements, so a regeneration reuses their ids where it can. */
  movements: Section[];
}

const newId = () => crypto.randomUUID();

/**
 * Keeps only references the workspace can actually resolve.
 *
 * Returns the surviving references and how many were discarded, because
 * silently dropping a claim's grounding is exactly the kind of thing that
 * should be visible to the person about to stand up and say it.
 */
export function verifyEvidence(
  ids: string[],
  available: AvailableEvidence[],
): { evidence: EvidenceRef[]; dropped: number } {
  const byId = new Map(available.map((item) => [item.id, item]));
  const evidence: EvidenceRef[] = [];
  let dropped = 0;

  for (const id of ids) {
    const match = byId.get(id);
    if (!match) {
      dropped += 1;
      continue;
    }
    if (evidence.some((existing) => existing.id === match.id)) continue;
    evidence.push({ kind: match.kind, id: match.id, label: match.label });
  }

  return { evidence, dropped };
}

/**
 * Builds movements and moments from a proposal.
 *
 * `merge.movements` lets a regeneration reuse an existing movement's id when
 * the proposal keeps the same short label, so the rail, the scenes filed under
 * it and its stored purpose all survive. A movement that genuinely changed
 * becomes a new one.
 */
export function draftFromProposal(
  proposal: ProposedMap,
  options: {
    presentationId: string;
    totalSeconds: number;
    available: AvailableEvidence[];
    merge?: MergeContext;
  },
): { draft: MapDraft; droppedEvidence: number } {
  const now = new Date().toISOString();
  const existingByLabel = new Map(
    (options.merge?.movements ?? []).map((movement) => [movement.label.toLowerCase(), movement]),
  );

  const movementSeconds = distributeSeconds(
    proposal.movements.map((movement) => movement.weight),
    options.totalSeconds,
  );

  const movements: Section[] = [];
  const moments: Moment[] = [];
  let droppedEvidence = 0;

  proposal.movements.forEach((proposed, index) => {
    const reused = existingByLabel.get(proposed.label.toLowerCase());
    const movementId = reused?.id ?? newId();

    movements.push({
      id: movementId,
      presentationId: options.presentationId,
      title: proposed.title,
      label: proposed.label,
      purpose: proposed.purpose,
      position: index,
      createdAt: reused?.createdAt ?? now,
      updatedAt: now,
    });

    const within = distributeSeconds(
      proposed.moments.map((moment) => moment.weight),
      movementSeconds[index],
    );

    proposed.moments.forEach((moment, momentIndex) => {
      const verified = verifyEvidence(moment.evidenceIds, options.available);
      droppedEvidence += verified.dropped;

      moments.push({
        id: newId(),
        presentationId: options.presentationId,
        movementId,
        title: moment.title,
        role: moment.role,
        purpose: moment.purpose,
        takeaway: moment.takeaway,
        estimatedSeconds: within[momentIndex],
        evidence: verified.evidence,
        visualIntent: moment.visualIntent,
        instructions: "",
        locked: false,
        position: momentIndex,
        createdAt: now,
        updatedAt: now,
      });
    });
  });

  // Locked moments are the author's. They keep their id, their movement where
  // it still exists, and their place at the end of it.
  for (const locked of options.merge?.locked ?? []) {
    const home = movements.find((movement) => movement.id === locked.movementId);
    const movementId = home?.id ?? movements[0]?.id ?? null;
    const siblings = moments.filter((moment) => moment.movementId === movementId);
    moments.push({ ...locked, movementId, position: siblings.length });
  }

  return {
    draft: {
      movements,
      moments,
      approach: proposal.approach,
      suggestedThemeId: proposal.suggestedThemeId,
    },
    droppedEvidence,
  };
}

/* -------------------------------------------------------------------------- */
/* Scene generation input                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Everything a scene needs to know about the argument around it.
 *
 * Neighbours are included so a transition can be written from where the room
 * has just been and where it is going, rather than from a boilerplate sentence
 * stamped onto every scene.
 */
export interface MomentBrief {
  momentId: string;
  movementLabel: string;
  movementTitle: string;
  movementPurpose: string;
  title: string;
  role: NarrativeRole;
  purpose: string;
  takeaway: string;
  estimatedSeconds: number;
  visualIntent: VisualIntent;
  instructions: string;
  evidence: EvidenceRef[];
  previousTitle: string | null;
  nextTitle: string | null;
  /** True where this is the last moment of its movement. */
  endsMovement: boolean;
  nextMovementLabel: string | null;
}

/** Flattens a map into per-moment briefs, in presentation order. */
export function briefsFor(movements: Section[], moments: Moment[]): MomentBrief[] {
  const ordered = [...movements].sort((a, b) => a.position - b.position);
  const flat: { moment: Moment; movement: Section }[] = [];

  for (const movement of ordered) {
    const own = moments
      .filter((moment) => moment.movementId === movement.id)
      .sort((a, b) => a.position - b.position);
    for (const moment of own) flat.push({ moment, movement });
  }

  // Moments with no movement still generate; they go last, and say so.
  const loose = moments.filter((moment) => moment.movementId === null);
  for (const moment of loose.sort((a, b) => a.position - b.position)) {
    flat.push({
      moment,
      movement: {
        id: "",
        presentationId: moment.presentationId,
        title: "Unplaced",
        label: "",
        purpose: "",
        position: ordered.length,
        createdAt: moment.createdAt,
        updatedAt: moment.updatedAt,
      },
    });
  }

  return flat.map((entry, index) => {
    const next = flat[index + 1];
    const endsMovement = !next || next.movement.id !== entry.movement.id;

    return {
      momentId: entry.moment.id,
      movementLabel: entry.movement.label || entry.movement.title,
      movementTitle: entry.movement.title,
      movementPurpose: entry.movement.purpose,
      title: entry.moment.title,
      role: entry.moment.role,
      purpose: entry.moment.purpose,
      takeaway: entry.moment.takeaway,
      estimatedSeconds: entry.moment.estimatedSeconds,
      visualIntent: entry.moment.visualIntent,
      instructions: entry.moment.instructions,
      evidence: entry.moment.evidence,
      previousTitle: flat[index - 1]?.moment.title ?? null,
      nextTitle: next?.moment.title ?? null,
      endsMovement,
      nextMovementLabel: endsMovement
        ? ((next?.movement.label || next?.movement.title) ?? null)
        : null,
    };
  });
}

/**
 * The layout a visual intent asks for, given the role.
 *
 * Intent is deliberately one level above layout, so this mapping lives in the
 * application rather than in the map: changing how a comparison is composed
 * should not require rewriting every presentation that contains one.
 */
export function layoutFor(
  intent: VisualIntent,
  role: NarrativeRole,
  index: number,
):
  | "title"
  | "statement"
  | "bullets"
  | "two-column"
  | "three-up"
  | "chart"
  | "media-full"
  | "quote"
  | "split-left"
  | "split-right"
  | "code"
  | "closing"
  | "section" {
  switch (intent) {
    case "statement":
      return "statement";
    case "comparison":
      return "two-column";
    case "data":
      return "chart";
    case "sequence":
      return "three-up";
    case "imagery":
      return "media-full";
    case "quotation":
      return "quote";
    case "enumeration":
      return "bullets";
    case "demonstration":
      return index % 2 === 0 ? "split-right" : "split-left";
    default:
      break;
  }

  switch (role) {
    case "hook":
    case "provocation":
    case "question":
      return index === 0 ? "title" : "statement";
    case "claim":
    case "reframe":
    case "synthesis":
      return "statement";
    case "evidence":
      return "chart";
    case "contrast":
      return "two-column";
    case "example":
    case "demonstration":
      return index % 2 === 0 ? "split-right" : "split-left";
    case "application":
      return "three-up";
    case "callback":
      return "quote";
    case "transition":
      return "section";
    case "close":
      return "closing";
    default:
      return "bullets";
  }
}
