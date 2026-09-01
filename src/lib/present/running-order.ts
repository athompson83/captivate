import type { Scene } from "@/lib/schema/presentation";

/**
 * The running order: the scenes the audience walks through, in order.
 *
 * A detail scene is an aside. It is reached by clicking a hotspot, it is
 * stepped over by next and previous, and it may never be opened at all — so it
 * is not a beat of the talk and does not have a place in the count.
 *
 * The filter itself is one line, and that is exactly why it kept being written
 * out again slightly differently: the analysis summed asides into the running
 * time, the narrative map called an aside stored last the close of the
 * argument, and the scene jumper numbered by array position while the progress
 * bar beside it numbered by running order — two controls in one console
 * disagreeing, with no way for the presenter to tell which was lying.
 *
 * These are the shared answers. A surface that needs to number, count or list
 * the argument uses one of them rather than its own copy, so a test on this
 * module is a test on all of them.
 */

/** Only what the audience is walked through. */
export function runningOrder<T extends Pick<Scene, "flowRole">>(scenes: readonly T[]): T[] {
  return scenes.filter((scene) => scene.flowRole !== "detail");
}

/** How many beats the talk has. */
export function runningOrderLength(scenes: readonly Pick<Scene, "flowRole">[]): number {
  return runningOrder(scenes).length;
}

/**
 * Each main scene's place in the running order, by id, 1-based. Asides are
 * absent rather than zero: they have no position, which is a different thing
 * from having position zero.
 */
export function runningOrderOrdinals(
  scenes: readonly Pick<Scene, "id" | "flowRole">[],
): Map<string, number> {
  const ordinals = new Map<string, number>();
  let position = 0;
  for (const scene of scenes) {
    if (scene.flowRole === "detail") continue;
    position += 1;
    ordinals.set(scene.id, position);
  }
  return ordinals;
}

/**
 * Jump targets: what a presenter may jump to, carrying both numbers.
 *
 * `index` is where the scene lives in the array and is what navigation needs —
 * renumbering it would send the presenter to the wrong scene, which is why the
 * displayed number was left wrong instead. `ordinal` is its place in the
 * argument and is what the presenter is shown.
 */
export function jumpTargets<T extends Pick<Scene, "id" | "flowRole">>(
  scenes: readonly T[],
): { scene: T; index: number; ordinal: number }[] {
  const targets: { scene: T; index: number; ordinal: number }[] = [];
  scenes.forEach((scene, index) => {
    if (scene.flowRole === "detail") return;
    targets.push({ scene, index, ordinal: targets.length + 1 });
  });
  return targets;
}

/**
 * How far through the argument the presenter is, 1-based.
 *
 * Inside an aside this is the position of the main scene it hangs off, which
 * is the honest answer: the talk has not moved on.
 */
export function ordinalAt(scenes: readonly Pick<Scene, "flowRole">[], sceneIndex: number): number {
  return runningOrderLength(scenes.slice(0, sceneIndex + 1));
}
