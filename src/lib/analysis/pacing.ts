import type { Scene, SceneElement, Section } from "@/lib/schema/presentation";
import { runningOrder } from "@/lib/present/running-order";

/**
 * How long a presentation actually takes.
 *
 * Every scene carries an optional rehearsal target, and almost nobody sets one.
 * An estimate that only counts the scenes with a number on them is worse than
 * useless — it reports a forty-minute lecture as two minutes — so this estimates
 * from the content itself and lets an authored duration override it.
 *
 * The model is deliberately simple and stated rather than tuned: a presenter
 * speaks the words on a scene, pauses on an image, and takes a beat for each
 * build step. Getting the constants exactly right is impossible; being explicit
 * about them is not.
 */

/** Words a minute, spoken aloud to a room. Slower than reading silently. */
const WORDS_PER_MINUTE = 130;

/** A presenter says roughly this much per bullet beyond reading it out. */
const SECONDS_PER_BULLET = 4;

/** A beat to let the room look at a picture, a chart, or a diagram. */
const SECONDS_PER_MEDIA = 6;

/** Each build step is a deliberate pause. */
const SECONDS_PER_STEP = 3;

/** Nobody is on a scene for less than this, whatever is on it. */
const MINIMUM_SECONDS = 8;

export interface ScenePace {
  sceneId: string;
  /** Seconds, authored where set and estimated otherwise. */
  seconds: number;
  estimated: boolean;
  words: number;
}

export interface MovementPace {
  sectionId: string | null;
  label: string;
  seconds: number;
  sceneCount: number;
  /** Share of the whole presentation, 0..1. */
  share: number;
}

export interface Pacing {
  scenes: ScenePace[];
  movements: MovementPace[];
  totalSeconds: number;
  /** True where at least one scene carries an authored rehearsal target. */
  anyAuthored: boolean;
}

/** Every word of visible text on a scene. */
export function wordsOn(elements: SceneElement[]): number {
  let words = 0;

  const count = (text: string) => {
    const trimmed = text.trim();
    if (trimmed) words += trimmed.split(/\s+/).length;
  };

  for (const element of elements) {
    if (element.hidden) continue;
    switch (element.type) {
      case "heading":
      case "text":
        for (const run of element.content) count(run.text);
        break;
      case "quote":
        for (const run of element.content) count(run.text);
        count(element.attribution);
        break;
      case "list":
        // Each item is itself a run list, not an element with content.
        for (const item of element.items) for (const run of item) count(run.text);
        break;
      case "callout":
        count(element.title);
        for (const run of element.content) count(run.text);
        break;
      case "chart":
        count(element.title);
        // The summary is read to the room as the point of the chart.
        count(element.summary);
        break;
      case "code":
        // Code is not read aloud word by word; it is pointed at.
        break;
      default:
        break;
    }
  }

  return words;
}

/** Elements the room stops to look at rather than listen through. */
function mediaCount(elements: SceneElement[]): number {
  return elements.filter(
    (element) =>
      !element.hidden &&
      (element.type === "image" ||
        element.type === "video" ||
        element.type === "chart" ||
        element.type === "embed"),
  ).length;
}

function bulletCount(elements: SceneElement[]): number {
  return elements.reduce(
    (total, element) =>
      element.type === "list" && !element.hidden ? total + element.items.length : total,
    0,
  );
}

function buildSteps(elements: SceneElement[]): number {
  return elements.filter((element) => !element.hidden && element.animation.onAdvance).length;
}

/** The estimate for one scene, ignoring any authored target. */
export function estimateScene(scene: Scene): number {
  const elements = scene.content.elements;
  const words = wordsOn(elements);

  const spoken = (words / WORDS_PER_MINUTE) * 60;
  const seconds =
    spoken +
    bulletCount(elements) * SECONDS_PER_BULLET +
    mediaCount(elements) * SECONDS_PER_MEDIA +
    buildSteps(elements) * SECONDS_PER_STEP;

  return Math.max(MINIMUM_SECONDS, Math.round(seconds));
}

export function pacingOf(scenes: Scene[], sections: Section[]): Pacing {
  const labels = new Map(
    sections.map((section) => [section.id, section.label.trim() || section.title.trim()]),
  );

  // The talk is the running order. A detail scene is an aside behind a
  // hotspot: it may never be opened, and counting it inflates the estimate
  // that exists precisely so the length reported is close to the real one.
  // The rail's `movementsOf` extends a movement *over* an aside rather than
  // letting it split one, and the grouping below has to do the same — a detail
  // scene with a different (or null) section id sitting between two scenes of
  // one movement would otherwise report that movement twice.
  const running = runningOrder(scenes);

  const paced: ScenePace[] = running.map((scene) => {
    const authored = scene.durationSeconds;
    return {
      sceneId: scene.id,
      seconds: authored && authored > 0 ? authored : estimateScene(scene),
      estimated: !(authored && authored > 0),
      words: wordsOn(scene.content.elements),
    };
  });

  const totalSeconds = paced.reduce((sum, scene) => sum + scene.seconds, 0);

  // Movements follow the same consecutive-run grouping the rail uses: two
  // separate stretches of one section are two movements, not one.
  const movements: MovementPace[] = [];
  running.forEach((scene, index) => {
    const current = movements[movements.length - 1];
    const sectionId = scene.sectionId;

    if (current && current.sectionId === sectionId) {
      current.seconds += paced[index].seconds;
      current.sceneCount += 1;
      return;
    }

    movements.push({
      sectionId,
      label: sectionId ? (labels.get(sectionId) ?? "") : "",
      seconds: paced[index].seconds,
      sceneCount: 1,
      share: 0,
    });
  });

  for (const movement of movements) {
    movement.share = totalSeconds > 0 ? movement.seconds / totalSeconds : 0;
  }

  return {
    scenes: paced,
    movements,
    totalSeconds,
    anyAuthored: paced.some((scene) => !scene.estimated),
  };
}

/**
 * How evenly the time is spread across movements, 0..1.
 *
 * One is perfectly even. The measure is one minus the mean absolute deviation
 * from an equal share, normalised — which is bounded, behaves sensibly for two
 * movements as well as ten, and does not punish a deliberately short opener as
 * harshly as a variance-based measure would.
 */
export function balance(pacing: Pacing): number {
  const movements = pacing.movements.filter((m) => m.sceneCount > 0);
  if (movements.length < 2) return 1;

  const equal = 1 / movements.length;
  const deviation =
    movements.reduce((sum, m) => sum + Math.abs(m.share - equal), 0) / movements.length;

  // The worst case is all the time in one movement, where the mean deviation
  // is 2(n-1)/n²; dividing by it puts the result on 0..1.
  const worst = (2 * (movements.length - 1)) / (movements.length * movements.length);
  return Math.max(0, Math.min(1, 1 - deviation / worst));
}

/** "17 min 30 sec", or "45 sec" for something short. */
export function formatDuration(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(rounded / 60);
  const rest = rounded % 60;
  if (minutes === 0) return `${rest} sec`;
  if (rest === 0) return `${minutes} min`;
  return `${minutes} min ${rest} sec`;
}
