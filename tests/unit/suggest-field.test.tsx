import { describe, expect, it } from "vitest";
import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Suggest } from "@/components/ui/input";

/**
 * The audience field, and why it is not a `<datalist>`.
 *
 * `<input list>` is the right element for "a text field with some suggestions"
 * and it could not be typed into on an iPad. WebKit rebuilds the suggestion
 * popup on every `input` event, and rebuilding it dismisses the on-screen
 * keyboard — so the reported symptom was losing the keyboard after every
 * single letter, on the first field of the flow that creates a presentation.
 *
 * A keyboard is not something jsdom has, so what these assert is the thing the
 * keyboard follows: **focus never leaves the input**. On iOS those are the same
 * fact. Each test below is a way focus was lost, or would be lost by an
 * innocent-looking change here.
 */

function Harness({ initial = "" }: { initial?: string }) {
  const [value, setValue] = useState(initial);
  return (
    <Suggest
      label="Audience"
      options={["University students", "EMS and paramedic students", "Clinical staff"]}
      value={value}
      onValueChange={setValue}
    />
  );
}

describe("a text field that suggests without taking over", () => {
  it("keeps focus through every keystroke while the list filters under it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByLabelText("Audience");

    await user.click(field);
    // Typed one character at a time, because the failure was per-character:
    // the list re-renders on each one, and the field must survive all of them.
    for (const letter of "student") {
      await user.keyboard(letter);
      expect(document.activeElement, `focus was lost typing "${letter}"`).toBe(field);
    }

    expect(field).toHaveValue("student");
    // And the whole word arrived — the symptom was only getting one letter in.
    expect(screen.getByRole("listbox")).toBeInTheDocument();
  });

  it("does not write a suggestion into the field on its own", async () => {
    // An offer, not an autofill. Typing "Uni" must leave "Uni" in the field
    // even though exactly one suggestion matches it.
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByLabelText("Audience");

    await user.click(field);
    await user.keyboard("Uni");

    expect(field).toHaveValue("Uni");
    expect(screen.getByRole("option", { name: "University students" })).toBeInTheDocument();
  });

  it("keeps focus in the field when a suggestion is chosen by pointer", async () => {
    // The one that matters most on a touch device. Choosing has to happen on
    // pointerdown with the default prevented; on `click` the field has already
    // blurred and the keyboard has already gone.
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByLabelText("Audience");

    await user.click(field);
    await user.keyboard("clin");
    await user.click(screen.getByRole("option", { name: "Clinical staff" }));

    expect(field).toHaveValue("Clinical staff");
    expect(document.activeElement, "choosing a suggestion must not blur the field").toBe(field);
    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
  });

  it("leaves Enter alone until a suggestion is deliberately highlighted", async () => {
    // The list opens with nothing active. If Enter were captured by a
    // highlighted first row, an author who typed their own audience and
    // pressed Enter would get somebody else's words instead.
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByLabelText("Audience");

    await user.click(field);
    await user.keyboard("Night shift crew{Enter}");

    expect(field).toHaveValue("Night shift crew");
  });

  it("accepts the highlighted suggestion once the author arrows onto it", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByLabelText("Audience");

    await user.click(field);
    await user.keyboard("students{ArrowDown}{Enter}");

    expect(field).toHaveValue("University students");
    expect(document.activeElement).toBe(field);
  });

  it("gets out of the way when nothing matches", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByLabelText("Audience");

    await user.click(field);
    await user.keyboard("zzz");

    expect(screen.queryByRole("listbox")).not.toBeInTheDocument();
    expect(field).toHaveValue("zzz");
  });

  it("offers nothing once the field already says it", async () => {
    // An exact match is not a suggestion, it is the current value, and a list
    // covering the field with one row repeating it is just in the way.
    render(<Harness initial="Clinical staff" />);
    const user = userEvent.setup();

    await user.click(screen.getByLabelText("Audience"));

    expect(screen.queryByRole("option", { name: "Clinical staff" })).not.toBeInTheDocument();
  });

  it("says what it is to a screen reader", async () => {
    const user = userEvent.setup();
    render(<Harness />);
    const field = screen.getByLabelText("Audience");

    expect(field).toHaveAttribute("role", "combobox");
    expect(field).toHaveAttribute("aria-expanded", "false");

    await user.click(field);
    await user.keyboard("students{ArrowDown}");

    expect(field).toHaveAttribute("aria-expanded", "true");
    // The active row has to be named, or arrowing through the list is silent.
    const activeId = field.getAttribute("aria-activedescendant");
    expect(activeId).toBeTruthy();
    expect(document.getElementById(activeId!)).toHaveAttribute("aria-selected", "true");
  });
});

describe("the create flow's audience field", () => {
  it("is not a datalist anywhere in the brief", async () => {
    // The regression guard. `<input list>` reads as the tasteful choice and is
    // exactly what broke; a future edit "simplifying" this back would
    // reintroduce a field that cannot be typed into on an iPad, and nothing
    // else here would notice.
    const source = await import("node:fs").then((fs) =>
      fs.readFileSync("src/components/dashboard/create-flow.tsx", "utf8"),
    );
    // Comments stripped first, because the replacement is explained in one and
    // a guard that its own explanation trips is a guard nobody keeps.
    const markup = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(markup).not.toContain("<datalist");
    expect(markup).not.toMatch(/\blist=["{]/);
  });
});
