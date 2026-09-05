/**
 * The presenter's keys, as a list.
 *
 * The presenter bar hides itself after a couple of seconds and every action on
 * it has a key, which is the right design for the room and the wrong one for
 * a first night: the affordances are gone before they have been read. `?`
 * puts this list over the stage on demand. It is data rather than prose so a
 * test can hold it to the stage's real key handler — a key added there and
 * not here is the bug this file exists to prevent.
 */
export interface PresenterKey {
  keys: string;
  action: string;
  group: "Moving" | "The camera" | "Marking up" | "Help";
}

export const PRESENTER_KEYS: PresenterKey[] = [
  { keys: "→  Space  Enter  PageDown", action: "Next build, then next scene", group: "Moving" },
  { keys: "←  Backspace  PageUp", action: "Back", group: "Moving" },
  { keys: "Home  /  End", action: "First / last scene", group: "Moving" },
  { keys: "1 – 9, 0", action: "Jump to scene one to ten", group: "Moving" },
  { keys: "O", action: "Pull back over the whole argument", group: "The camera" },
  { keys: "F", action: "Full screen", group: "The camera" },
  { keys: "B  or  .", action: "Blank the screen", group: "The camera" },
  { keys: "V", action: "Show or hide your camera", group: "The camera" },
  { keys: "L", action: "Laser pointer", group: "Marking up" },
  { keys: "H", action: "Highlight an area", group: "Marking up" },
  { keys: "D", action: "Draw", group: "Marking up" },
  { keys: "E", action: "Erase", group: "Marking up" },
  { keys: "C", action: "Clear this scene's marks", group: "Marking up" },
  { keys: "Esc", action: "Put the tool down, or leave the overview", group: "Help" },
  { keys: "?", action: "Show or hide these keys", group: "Help" },
];

/** Every key name the stage answers to, flattened for the test that holds them together. */
export const PRESENTER_KEY_NAMES = new Set(
  PRESENTER_KEYS.flatMap((entry) =>
    entry.keys
      .replace(/–/g, " ")
      .split(/\s+(?:or|\/)?\s*|,\s*/)
      .map((k) => k.trim())
      .filter(Boolean),
  ),
);
