import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { SHORTCUTS, useEditorShortcuts } from "@/lib/editor/shortcuts";
import { PRESENTER_KEYS, PRESENTER_KEY_NAMES } from "@/lib/present/keys";
import { PresenterHelp } from "@/components/present/presenter-help";
import { EmptySceneHint } from "@/components/editor/empty-scene-hint";

/**
 * Help is a key away. `?` opens the editor's shortcut list and the stage's
 * key overlay, the list on the stage is held to the stage's real handler,
 * and an empty scene's third step is a button, not a key to remember.
 */

function Keys({ onHelp }: { onHelp: () => void }) {
  useEditorShortcuts({ onToggleNotes: () => {}, onToggleAi: () => {}, onSave: () => {}, onHelp });
  return <input aria-label="typing" />;
}

describe("? in the editor", () => {
  it("opens the shortcut list, except while typing", () => {
    const onHelp = vi.fn();
    render(<Keys onHelp={onHelp} />);
    fireEvent.keyDown(window, { key: "?" });
    expect(onHelp).toHaveBeenCalledTimes(1);

    fireEvent.keyDown(screen.getByLabelText("typing"), { key: "?" });
    expect(onHelp).toHaveBeenCalledTimes(1);
  });

  it("is listed among the shortcuts it opens", () => {
    expect(SHORTCUTS.some((s) => s.keys === "?")).toBe(true);
  });
});

describe("the presenter's keys", () => {
  it("cover every key the stage answers to", () => {
    const source = readFileSync("src/components/present/present-root.tsx", "utf8");
    const handler = source.slice(source.indexOf("const onKey = (e: KeyboardEvent)"));
    const cases = [...handler.matchAll(/case "([^"]+)":/g)].map((m) => m[1]);
    expect(cases.length).toBeGreaterThan(10);
    const named = (key: string) => {
      const alias: Record<string, string> = {
        ArrowRight: "→",
        ArrowLeft: "←",
        " ": "Space",
        Escape: "Esc",
      };
      return alias[key] ?? key;
    };
    for (const key of cases) {
      const name = named(key);
      // Letters are listed once, in upper case.
      const listed = PRESENTER_KEY_NAMES.has(name) || PRESENTER_KEY_NAMES.has(name.toUpperCase());
      expect(listed, `key "${key}" is handled by the stage but not listed`).toBe(true);
    }
    // And the digits, handled by a pattern rather than a case.
    expect(handler).toMatch(/\^\[0-9\]\$/);
    expect(PRESENTER_KEYS.some((k) => k.keys.includes("1"))).toBe(true);
  });

  it("render as a dialog the presenter can close by clicking away", () => {
    const onClose = vi.fn();
    render(<PresenterHelp onClose={onClose} />);
    const dialog = screen.getByRole("dialog", { name: "Presenter keys" });
    expect(dialog).toHaveTextContent("Laser pointer");
    expect(dialog).toHaveTextContent("Pull back over the whole argument");
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});

describe("an empty scene", () => {
  it("offers its third step as a button", () => {
    const onAskAi = vi.fn();
    render(<EmptySceneHint sceneId="00000000-0000-4000-8000-000000000001" onAskAi={onAskAi} />);
    expect(screen.getByRole("button", { name: "Add a heading" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use a layout" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Let AI draft it" }));
    expect(onAskAi).toHaveBeenCalledTimes(1);
  });
});
