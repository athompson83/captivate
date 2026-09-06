/**
 * Connecting a template's argument to a template's scenes.
 *
 * A template carries two things: the scenes an author opens, and — where it
 * declares a `shape` — the argument behind them, written as real moments. Both
 * are grouped by the same movement labels, and both are in order within a
 * movement, because they describe the same talk.
 *
 * They were nevertheless created as two unrelated sets of rows. The moments
 * went in with fresh database ids and the scenes went in with `moment_id`
 * null, so a deck made from "Hold the room" arrived with eleven scenes and a
 * narrative map of eight moments that pointed at none of them. Editing a
 * moment changed nothing on the deck, and generating scenes from that map
 * appended a second, parallel deck beside the first — eleven scenes became
 * nineteen, which is how this was found.
 *
 * The pairing is the obvious one and it is the only one available: within a
 * movement, the first moment is the first scene, the second the second. Where
 * the counts differ the surplus is left unpaired on whichever side has it — a
 * template with more scenes than beats has extra material, and a moment with
 * no scene yet is exactly what a generation is for.
 */

export interface PlacedScene {
  /** Index in the deck as created. */
  index: number;
  /** The movement it was filed into, or null for a deck with no movements. */
  sectionId: string | null;
}

export interface PlacedMoment {
  id: string;
  movementId: string | null;
  /** Position within its movement, as written. */
  position: number;
}

/**
 * The moment each scene belongs to, keyed by the scene's index.
 *
 * Scenes with no movement are never paired: a moment's position is only
 * meaningful inside one, and pairing across the whole deck would connect
 * beats to scenes that merely happen to be in the same order.
 */
export function pairTemplateMoments(
  scenes: readonly PlacedScene[],
  moments: readonly PlacedMoment[],
): Map<number, string> {
  const byMovement = new Map<string, string>();
  for (const moment of moments) {
    if (!moment.movementId) continue;
    // First write wins, so a shape that somehow repeats a position does not
    // silently reassign a scene that is already spoken for.
    const key = `${moment.movementId}:${moment.position}`;
    if (!byMovement.has(key)) byMovement.set(key, moment.id);
  }

  const seen = new Map<string, number>();
  const paired = new Map<number, string>();

  for (const scene of [...scenes].sort((a, b) => a.index - b.index)) {
    if (!scene.sectionId) continue;
    const position = seen.get(scene.sectionId) ?? 0;
    seen.set(scene.sectionId, position + 1);

    const id = byMovement.get(`${scene.sectionId}:${position}`);
    if (id) paired.set(scene.index, id);
  }

  return paired;
}
