/**
 * Deciding what a regeneration writes, without writing anything.
 *
 * Regenerating scenes used to be decided in the browser: the route handed back
 * every scene it had written and a loop in the page saved them one at a time.
 * That put the durability of a five-minute job behind a phone staying awake —
 * a lock screen between the answer arriving and the last save left a deck half
 * rewritten and looking finished.
 *
 * Moving the writes to the server removes the window, but the *decision* is
 * the part worth being sure about, and it is entirely a matter of matching
 * things up. So it lives here, pure, and the route executes what it returns.
 *
 * Four rules, and each one is a thing that would otherwise go quietly wrong:
 *
 *  - **a moment's scene is reused, never recreated.** The scene's own id is
 *    what recordings, thumbnails and any note anchor already point at, and a
 *    delete-and-insert would break all of them while looking identical;
 *  - **a scene belonging to no moment is never touched.** That is hand-made
 *    work, and an aside's detail scene, neither of which a regeneration wrote
 *    or may overwrite;
 *  - **a moment with no scene yet gets one**, filed under its own movement and
 *    appended, so a map that grew since the last generation fills in;
 *  - **matching is by moment, so running twice writes the same rows twice**
 *    rather than making a second copy. Idempotence here is what makes a
 *    resumable retry safe.
 */

export interface ExistingScene {
  id: string;
  momentId: string | null;
  position: number;
}

export interface WrittenScene {
  momentId: string;
  title: string;
  content: unknown;
  speakerNotes: string;
}

/** A moment, only as far as a write needs to know it. */
export interface MomentPlacement {
  id: string;
  movementId: string | null;
}

export type SceneWrite =
  | { kind: "update"; id: string; title: string; content: unknown; speakerNotes: string }
  | {
      kind: "insert";
      momentId: string;
      sectionId: string | null;
      position: number;
      title: string;
      content: unknown;
      speakerNotes: string;
    };

export interface WritePlan {
  writes: SceneWrite[];
  /** Scenes that will be rewritten in place. */
  replacing: number;
  /** Moments that had no scene and will get one. */
  creating: number;
  /**
   * Generated scenes naming a moment this presentation does not have.
   *
   * Dropped rather than written. A scene filed under nothing is invisible to
   * the running order and to the next regeneration, which would then create a
   * second one beside it.
   */
  unplaceable: number;
}

export function planSceneWrites(
  existing: readonly ExistingScene[],
  written: readonly WrittenScene[],
  moments: readonly MomentPlacement[],
): WritePlan {
  const sceneByMoment = new Map<string, ExistingScene>();
  for (const scene of existing) {
    // First scene wins where a moment somehow owns two: rewriting both would
    // leave the deck saying the same thing twice.
    if (scene.momentId && !sceneByMoment.has(scene.momentId))
      sceneByMoment.set(scene.momentId, scene);
  }
  const movementByMoment = new Map(moments.map((moment) => [moment.id, moment.movementId]));

  // New scenes go after everything that exists, in the order they were
  // written, so a map that grew reads in its own order rather than in
  // whatever order the rows come back.
  let next = existing.reduce((highest, scene) => Math.max(highest, scene.position), -1) + 1;

  const writes: SceneWrite[] = [];
  let replacing = 0;
  let creating = 0;
  let unplaceable = 0;

  for (const scene of written) {
    const match = sceneByMoment.get(scene.momentId);
    if (match) {
      writes.push({
        kind: "update",
        id: match.id,
        title: scene.title,
        content: scene.content,
        speakerNotes: scene.speakerNotes,
      });
      replacing += 1;
      continue;
    }

    if (!movementByMoment.has(scene.momentId)) {
      unplaceable += 1;
      continue;
    }

    writes.push({
      kind: "insert",
      momentId: scene.momentId,
      sectionId: movementByMoment.get(scene.momentId) ?? null,
      position: next,
      title: scene.title,
      content: scene.content,
      speakerNotes: scene.speakerNotes,
    });
    next += 1;
    creating += 1;
  }

  return { writes, replacing, creating, unplaceable };
}
