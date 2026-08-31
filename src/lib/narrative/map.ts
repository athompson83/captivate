import type { Scene, Section } from "@/lib/schema/presentation";
import {
  distributeSeconds,
  movementLabel,
  type MappedMovement,
  type Moment,
  type NarrativeMap,
  type NarrativeRole,
  type NarrativeShape,
} from "@/lib/schema/narrative";
import { estimateScene } from "@/lib/analysis/pacing";
import { runningOrder } from "@/lib/present/running-order";

/**
 * Assembling and deriving the narrative map.
 *
 * Everything here is pure. The map is built from movements and moments, and
 * where a presentation has no moments — every presentation made before this
 * existed — one is derived from its scenes so the author sees an honest
 * argument rather than an empty page.
 */

/* -------------------------------------------------------------------------- */
/* Assembly                                                                    */
/* -------------------------------------------------------------------------- */

export function assembleMap(
  movements: Section[],
  moments: Moment[],
  options: { derived?: boolean } = {},
): NarrativeMap {
  const ordered = [...movements].sort((a, b) => a.position - b.position);
  const byMovement = new Map<string | null, Moment[]>();

  for (const moment of moments) {
    const key = moment.movementId;
    const bucket = byMovement.get(key);
    if (bucket) bucket.push(moment);
    else byMovement.set(key, [moment]);
  }

  for (const bucket of byMovement.values()) {
    bucket.sort((a, b) => a.position - b.position);
  }

  const mapped: MappedMovement[] = ordered.map((movement, index) => {
    const own = byMovement.get(movement.id) ?? [];
    return {
      id: movement.id,
      title: movement.title,
      label: movementLabel(movement),
      purpose: movement.purpose,
      position: index,
      moments: own,
      estimatedSeconds: own.reduce((sum, moment) => sum + moment.estimatedSeconds, 0),
      unplaced: false,
    };
  });

  // Moments belonging to no movement are shown, not hidden. A half-organised
  // argument is a normal state, and quietly dropping beats from the map would
  // make the running total lie.
  const loose = byMovement.get(null) ?? [];
  if (loose.length > 0) {
    mapped.push({
      id: null,
      title: "Unplaced",
      label: "Unplaced",
      purpose: "Moments that have not been given a movement yet.",
      position: mapped.length,
      moments: loose,
      estimatedSeconds: loose.reduce((sum, moment) => sum + moment.estimatedSeconds, 0),
      unplaced: true,
    });
  }

  return {
    movements: mapped,
    totalSeconds: mapped.reduce((sum, movement) => sum + movement.estimatedSeconds, 0),
    momentCount: moments.length,
    derived: options.derived ?? false,
  };
}

/* -------------------------------------------------------------------------- */
/* Derivation                                                                  */
/* -------------------------------------------------------------------------- */

/**
 * A role guessed from where a scene sits and what layout it uses.
 *
 * A guess, and labelled as one in the interface. The alternative — giving every
 * derived moment the same role — would be tidier and would tell the author
 * nothing, and the first thing they would have to do is fix all of it anyway.
 */
function inferRole(scene: Scene, index: number, total: number): NarrativeRole {
  const layout = scene.content.layout;
  if (index === 0) return "hook";
  if (index === total - 1) return "close";

  switch (layout) {
    case "title":
    case "cover":
      return "frame";
    case "section":
      return "transition";
    case "statement":
      return "claim";
    case "quote":
      return "callback";
    case "chart":
      return "evidence";
    case "three-up":
    case "two-column":
      return "contrast";
    case "media-full":
      return "demonstration";
    case "code":
      return "example";
    case "closing":
      return "close";
    default:
      return "evidence";
  }
}

/**
 * Builds a narrative map for a presentation that has never had one.
 *
 * The moment's id is the scene's id. That is deliberate: it makes derivation
 * deterministic, so opening an old presentation twice produces the same map and
 * the ids stay stable across reloads without writing anything to the database.
 * The first edit persists these moments under those same ids, and the
 * moment-to-scene relationship is already correct.
 */
export function deriveMap(
  scenes: Scene[],
  sections: Section[],
): { map: NarrativeMap; moments: Moment[] } {
  const now = new Date().toISOString();
  const positionInMovement = new Map<string | null, number>();

  /**
   * A moment is a beat of the argument. An aside is not one.
   *
   * `inferRole` reads "open" and "close" from position, so a detail scene
   * stored first or last was labelled the opening or the close of an argument
   * it is not part of — and because `captivate_replace_moments` writes the map
   * whole, those phantom beats became permanent the first time the author
   * edited it.
   */
  const running = runningOrder(scenes);

  const moments: Moment[] = running.map((scene, index) => {
    const key = scene.sectionId;
    const position = positionInMovement.get(key) ?? 0;
    positionInMovement.set(key, position + 1);

    return {
      id: scene.id,
      presentationId: scene.presentationId,
      movementId: scene.sectionId,
      title: scene.title || `Moment ${index + 1}`,
      role: inferRole(scene, index, running.length),
      purpose: "",
      takeaway: "",
      estimatedSeconds: scene.durationSeconds ?? estimateScene(scene),
      evidence: [],
      visualIntent: "auto",
      instructions: "",
      locked: false,
      position,
      createdAt: scene.createdAt,
      updatedAt: now,
    };
  });

  return { map: assembleMap(sections, moments, { derived: true }), moments };
}

/* -------------------------------------------------------------------------- */
/* Templates                                                                   */
/* -------------------------------------------------------------------------- */

export interface ShapedMovement {
  label: string;
  title: string;
  purpose: string;
  moments: {
    title: string;
    role: NarrativeRole;
    purpose: string;
    takeaway: string;
    visualIntent: Moment["visualIntent"];
    estimatedSeconds: number;
  }[];
}

/**
 * Turns a template's recommended shape into concrete movements and moments for
 * a requested running time.
 *
 * Time is distributed by weight twice — across movements, then within each —
 * so the proportions a template recommends hold at any length, and the totals
 * still add up to exactly what was asked for.
 */
export function applyShape(shape: NarrativeShape, totalSeconds: number): ShapedMovement[] {
  const movementSeconds = distributeSeconds(
    shape.map((movement) => movement.weight),
    totalSeconds,
  );

  return shape.map((movement, index) => {
    const within = distributeSeconds(
      movement.moments.map((moment) => moment.weight),
      movementSeconds[index],
    );

    return {
      label: movement.label,
      title: movement.title,
      purpose: movement.purpose,
      moments: movement.moments.map((moment, momentIndex) => ({
        title: moment.title,
        role: moment.role,
        purpose: moment.purpose,
        takeaway: moment.takeaway,
        visualIntent: moment.visualIntent,
        estimatedSeconds: within[momentIndex],
      })),
    };
  });
}

/* -------------------------------------------------------------------------- */
/* Ordering                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Moves a moment to a position, possibly in a different movement.
 *
 * Returns every moment whose stored position changed, so the caller writes the
 * minimum. Positions are renumbered densely inside each affected movement —
 * sparse positions survive a single move and then drift until two moments claim
 * the same index and the order becomes whatever the database felt like.
 */
export function moveMoment(
  moments: Moment[],
  momentId: string,
  toMovementId: string | null,
  toIndex: number,
): Moment[] {
  const moving = moments.find((moment) => moment.id === momentId);
  if (!moving) return moments;

  const fromMovementId = moving.movementId;
  const remaining = moments.filter((moment) => moment.id !== momentId);

  const target = remaining
    .filter((moment) => moment.movementId === toMovementId)
    .sort((a, b) => a.position - b.position);

  const clamped = Math.max(0, Math.min(target.length, toIndex));
  target.splice(clamped, 0, { ...moving, movementId: toMovementId });

  const renumbered = new Map<string, Moment>();
  target.forEach((moment, index) => {
    renumbered.set(moment.id, { ...moment, movementId: toMovementId, position: index });
  });

  if (fromMovementId !== toMovementId) {
    remaining
      .filter((moment) => moment.movementId === fromMovementId)
      .sort((a, b) => a.position - b.position)
      .forEach((moment, index) => {
        renumbered.set(moment.id, { ...moment, position: index });
      });
  }

  return moments.map((moment) => renumbered.get(moment.id) ?? moment);
}

/** Every moment whose stored fields differ between two lists. */
export function changedMoments(before: Moment[], after: Moment[]): Moment[] {
  const previous = new Map(before.map((moment) => [moment.id, moment]));
  return after.filter((moment) => {
    const was = previous.get(moment.id);
    if (!was) return true;
    return (
      was.movementId !== moment.movementId ||
      was.position !== moment.position ||
      was.title !== moment.title ||
      was.role !== moment.role ||
      was.purpose !== moment.purpose ||
      was.takeaway !== moment.takeaway ||
      was.estimatedSeconds !== moment.estimatedSeconds ||
      was.visualIntent !== moment.visualIntent ||
      was.instructions !== moment.instructions ||
      was.locked !== moment.locked ||
      JSON.stringify(was.evidence) !== JSON.stringify(moment.evidence)
    );
  });
}
