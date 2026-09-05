import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  STRUCTURE_COUNT,
  TEMPLATES,
  orderedTemplates,
  templateKind,
} from "@/lib/templates/registry";

/**
 * The registry keeps the finished talk, the structures and the clear stage in
 * one list; the places that show it should not. The home page's count is of
 * structures, and the grid puts the finished talk first and the clear stage
 * last, each saying what it is.
 */
describe("template kinds", () => {
  it("tell the finished talk and the clear stage apart from the structures", () => {
    expect(templateKind({ id: "example" })).toBe("example");
    expect(templateKind({ id: "blank" })).toBe("blank");
    expect(templateKind({ id: "lecture" })).toBe("structure");
    expect(TEMPLATES.filter((t) => templateKind(t) === "example")).toHaveLength(1);
    expect(TEMPLATES.filter((t) => templateKind(t) === "blank")).toHaveLength(1);
  });

  it("count the structures, which is what the home page says", () => {
    expect(STRUCTURE_COUNT).toBe(TEMPLATES.length - 2);
    expect(STRUCTURE_COUNT).toBeGreaterThan(5);
    const home = readFileSync("src/app/(app)/home/page.tsx", "utf8");
    expect(home).toContain("STRUCTURE_COUNT");
    expect(home).not.toContain("TEMPLATES.length - 2");
  });

  it("order the grid: the finished talk first, the clear stage last, structures between", () => {
    const shown = orderedTemplates();
    expect(shown).toHaveLength(TEMPLATES.length);
    expect(templateKind(shown[0])).toBe("example");
    expect(templateKind(shown[shown.length - 1])).toBe("blank");
    expect(shown.slice(1, -1).every((t) => templateKind(t) === "structure")).toBe(true);
    // The structures keep the registry's own order.
    expect(shown.slice(1, -1).map((t) => t.id)).toEqual(
      TEMPLATES.filter((t) => templateKind(t) === "structure").map((t) => t.id),
    );
    const flow = readFileSync("src/components/dashboard/create-flow.tsx", "utf8");
    expect(flow).toContain("orderedTemplates()");
    expect(flow).toContain("A finished talk");
  });
});
