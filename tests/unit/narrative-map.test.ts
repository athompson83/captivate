import { describe, expect, it } from "vitest";
import {
  MAX_MOMENT_SECONDS,
  Moment,
  NarrativeShape,
  ROLE_META,
  ROLE_ORDER,
  VISUAL_INTENT_META,
  VisualIntent,
  distributeSeconds,
  movementLabel,
} from "@/lib/schema/narrative";
import {
  applyShape,
  assembleMap,
  changedMoments,
  deriveMap,
  moveMoment,
} from "@/lib/narrative/map";
import { briefsFor, draftFromProposal, layoutFor, verifyEvidence } from "@/lib/narrative/generate";
import { chooseShape, fallbackMap } from "@/lib/ai/narrative-fallback";
import { ProposedMap } from "@/lib/ai/schemas";
import { composeScene } from "@/lib/editor/layouts";
import type { Scene, Section } from "@/lib/schema/presentation";

const PRESENTATION = "00000000-0000-4000-8000-000000000fff";
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function movement(id: string, label: string, position: number, title = label): Section {
  return {
    id,
    presentationId: PRESENTATION,
    title,
    label,
    purpose: "",
    position,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

function moment(overrides: Partial<Moment> & { id: string }): Moment {
  return {
    presentationId: PRESENTATION,
    movementId: null,
    title: "A beat",
    role: "claim",
    purpose: "",
    takeaway: "",
    estimatedSeconds: 60,
    evidence: [],
    visualIntent: "auto",
    instructions: "",
    locked: false,
    position: 0,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

function scene(i: number, overrides: Partial<Scene> = {}): Scene {
  return {
    flowRole: "main" as const,
    id: uuid(i),
    presentationId: PRESENTATION,
    sectionId: null,
    position: i,
    title: `Scene ${i}`,
    content: composeScene("statement", { heading: "A short claim" }),
    placement: null,
    momentId: null,
    speakerNotes: "",
    durationSeconds: 90,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

/* -------------------------------------------------------------------------- */

describe("roles and visual intents", () => {
  it("explains every role in plain language", () => {
    // The interface never shows a bare role name, so a role without an
    // explanation would render as an empty tooltip rather than fail loudly.
    for (const role of ROLE_ORDER) {
      expect(ROLE_META[role].label.length).toBeGreaterThan(0);
      expect(ROLE_META[role].plain.length).toBeGreaterThan(0);
      expect(ROLE_META[role].plain).not.toBe(ROLE_META[role].label);
    }
    expect(ROLE_ORDER).toHaveLength(16);
  });

  it("explains every visual intent", () => {
    for (const intent of VisualIntent.options) {
      expect(VISUAL_INTENT_META[intent].plain.length).toBeGreaterThan(0);
    }
  });

  it("rejects a role that is not in the vocabulary", () => {
    const parsed = Moment.safeParse({ ...moment({ id: uuid(1) }), role: "vibes" });
    expect(parsed.success).toBe(false);
  });

  it("refuses a moment long enough to eat a whole talk", () => {
    const parsed = Moment.safeParse({
      ...moment({ id: uuid(1) }),
      estimatedSeconds: MAX_MOMENT_SECONDS + 1,
    });
    expect(parsed.success).toBe(false);
  });

  it("fills the optional editorial fields rather than leaving them undefined", () => {
    const parsed = Moment.parse({
      id: uuid(1),
      presentationId: PRESENTATION,
      movementId: null,
      title: "A beat",
      role: "claim",
      position: 0,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: "2026-01-01T00:00:00Z",
    });
    expect(parsed).toMatchObject({
      purpose: "",
      takeaway: "",
      evidence: [],
      visualIntent: "auto",
      locked: false,
      estimatedSeconds: 0,
    });
  });
});

/* -------------------------------------------------------------------------- */

describe("assembling the map", () => {
  const movements = [movement("m2", "PROVE", 1), movement("m1", "OPEN", 0)];
  const moments = [
    moment({ id: uuid(3), movementId: "m1", position: 1, title: "Second" }),
    moment({ id: uuid(1), movementId: "m1", position: 0, title: "First" }),
    moment({ id: uuid(2), movementId: "m2", position: 0, title: "Third" }),
  ];

  it("orders movements and their moments by stored position, not by arrival", () => {
    const map = assembleMap(movements, moments);
    expect(map.movements.map((m) => m.label)).toEqual(["OPEN", "PROVE"]);
    expect(map.movements[0].moments.map((m) => m.title)).toEqual(["First", "Second"]);
  });

  it("shows moments with no movement rather than dropping them from the total", () => {
    // A half-organised argument is a normal state. Hiding the loose beats would
    // make the running total disagree with the map above it.
    const loose = moment({ id: uuid(9), movementId: null, estimatedSeconds: 45 });
    const map = assembleMap(movements, [...moments, loose]);

    const unplaced = map.movements.at(-1);
    expect(unplaced?.unplaced).toBe(true);
    expect(unplaced?.moments).toHaveLength(1);
    expect(map.momentCount).toBe(4);
    expect(map.totalSeconds).toBe(60 * 3 + 45);
  });

  it("adds no unplaced band when every moment has a home", () => {
    expect(assembleMap(movements, moments).movements.every((m) => !m.unplaced)).toBe(true);
  });

  it("sums each movement's own time", () => {
    const map = assembleMap(movements, moments);
    expect(map.movements[0].estimatedSeconds).toBe(120);
    expect(map.movements[1].estimatedSeconds).toBe(60);
    expect(map.totalSeconds).toBe(180);
  });

  it("falls back to the movement title where no short label is set", () => {
    const map = assembleMap([movement("m3", "", 0, "The evidence")], []);
    expect(map.movements[0].label).toBe("The evidence");
    expect(movementLabel({ label: "  ", title: "Opening" })).toBe("Opening");
  });
});

/* -------------------------------------------------------------------------- */

describe("duration planning", () => {
  it("distributes a target so the parts add up to exactly the whole", () => {
    // A running total eleven seconds short of the number above it reads as a
    // bug, because it is one.
    for (const total of [900, 1000, 1234, 60, 7]) {
      const parts = distributeSeconds([1, 1, 1], total);
      expect(parts.reduce((a, b) => a + b, 0)).toBe(total);
    }
  });

  it("honours the proportions it was given", () => {
    expect(distributeSeconds([1, 3], 400)).toEqual([100, 300]);
  });

  it("gives the remainder to the largest fractions", () => {
    // 10 across three equal parts is 3.33 each; the two extra seconds go
    // somewhere rather than evaporating.
    const parts = distributeSeconds([1, 1, 1], 10);
    expect(parts.reduce((a, b) => a + b, 0)).toBe(10);
    expect(Math.max(...parts) - Math.min(...parts)).toBe(1);
  });

  it("returns zeros rather than dividing by nothing", () => {
    expect(distributeSeconds([0, 0], 600)).toEqual([0, 0]);
    expect(distributeSeconds([], 600)).toEqual([]);
  });
});

/* -------------------------------------------------------------------------- */

describe("template narrative shapes", () => {
  const shape: NarrativeShape = NarrativeShape.parse([
    {
      label: "OPEN",
      title: "Why this matters",
      purpose: "Earn attention.",
      weight: 1,
      moments: [
        { title: "The situation", role: "hook", purpose: "Start where they live.", weight: 1 },
        { title: "The contract", role: "frame", purpose: "Say what follows.", weight: 1 },
      ],
    },
    {
      label: "PROVE",
      title: "Why believe it",
      purpose: "Ground the claim.",
      weight: 3,
      moments: [{ title: "The data", role: "evidence", purpose: "Show the support.", weight: 1 }],
    },
  ]);

  it("keeps a template's proportions at whatever length was asked for", () => {
    const short = applyShape(shape, 600);
    const long = applyShape(shape, 3600);

    const shareOf = (applied: ReturnType<typeof applyShape>, index: number, total: number) =>
      applied[index].moments.reduce((sum, m) => sum + m.estimatedSeconds, 0) / total;

    expect(shareOf(short, 1, 600)).toBeCloseTo(shareOf(long, 1, 3600), 2);
    expect(shareOf(short, 1, 600)).toBeCloseTo(0.75, 2);
  });

  it("adds up to the requested running time after distributing twice", () => {
    for (const total of [900, 1000, 1111]) {
      const applied = applyShape(shape, total);
      const sum = applied.flatMap((m) => m.moments).reduce((acc, m) => acc + m.estimatedSeconds, 0);
      expect(sum).toBe(total);
    }
  });

  it("carries the shape's editorial fields through, not just its timings", () => {
    const applied = applyShape(shape, 600);
    expect(applied[0].moments[0]).toMatchObject({
      role: "hook",
      purpose: "Start where they live.",
    });
    expect(applied[0].purpose).toBe("Earn attention.");
  });

  it("rejects a shape whose movement has no moments", () => {
    const parsed = NarrativeShape.safeParse([
      { label: "OPEN", title: "Open", purpose: "", weight: 1, moments: [] },
    ]);
    expect(parsed.success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe("backward conversion from existing presentations", () => {
  const sections = [movement("m1", "OPEN", 0), movement("m2", "PROVE", 1)];
  const scenes = [
    scene(1, { sectionId: "m1", title: "Opening" }),
    scene(2, { sectionId: "m1", content: composeScene("chart", { heading: "Growth" }) }),
    scene(3, { sectionId: "m2", content: composeScene("closing", { heading: "Thanks" }) }),
  ];

  it("gives a presentation with no moments a real map rather than an empty page", () => {
    const { map, moments } = deriveMap(scenes, sections);
    expect(map.derived).toBe(true);
    expect(moments).toHaveLength(3);
    expect(map.movements.map((m) => m.label)).toEqual(["OPEN", "PROVE"]);
  });

  it("does not turn an aside into a beat of the argument", () => {
    // A moment is a pre-generation beat; a detail scene is an aside reached by
    // clicking a hotspot. Worse, `inferRole` reads "open" and "close" from
    // position, so an aside stored last was labelled the close of an argument
    // it is not part of — and because the map is written whole, that phantom
    // beat became permanent the first time the author edited it.
    const withAside = [
      ...scenes,
      scene(4, { sectionId: "m2", flowRole: "detail", title: "The aside" }),
    ];
    const { moments } = deriveMap(withAside, sections);

    expect(moments).toHaveLength(3);
    expect(moments.map((m) => m.title)).not.toContain("The aside");
    // The real closing scene keeps the closing role rather than losing it to
    // an aside that happened to be stored after it.
    expect(moments[moments.length - 1].id).toBe(scenes[scenes.length - 1].id);
  });

  it("derives the same ids every time, so nothing has to be written to be stable", () => {
    const first = deriveMap(scenes, sections).moments.map((m) => m.id);
    const second = deriveMap(scenes, sections).moments.map((m) => m.id);
    expect(first).toEqual(second);
    // The moment's id is the scene's id: the relationship is already correct
    // before the first save.
    expect(first).toEqual(scenes.map((s) => s.id));
  });

  it("guesses a role from position and layout rather than labelling everything the same", () => {
    const { moments } = deriveMap(scenes, sections);
    expect(moments[0].role).toBe("hook");
    expect(moments[1].role).toBe("evidence");
    expect(moments[2].role).toBe("close");
  });

  it("numbers positions within each movement, not across the deck", () => {
    const { moments } = deriveMap(scenes, sections);
    expect(moments.map((m) => m.position)).toEqual([0, 1, 0]);
  });

  it("takes an authored duration over an estimate", () => {
    const { moments } = deriveMap([scene(1, { durationSeconds: 42 })], []);
    expect(moments[0].estimatedSeconds).toBe(42);
  });

  it("estimates a duration where the scene has none", () => {
    const { moments } = deriveMap([scene(1, { durationSeconds: null })], []);
    expect(moments[0].estimatedSeconds).toBeGreaterThan(0);
  });

  it("keeps scenes belonging to no movement", () => {
    const { map } = deriveMap([scene(1, { sectionId: null })], sections);
    expect(map.momentCount).toBe(1);
    expect(map.movements.at(-1)?.unplaced).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe("reordering moments", () => {
  const moments = [
    moment({ id: uuid(1), movementId: "m1", position: 0 }),
    moment({ id: uuid(2), movementId: "m1", position: 1 }),
    moment({ id: uuid(3), movementId: "m1", position: 2 }),
    moment({ id: uuid(4), movementId: "m2", position: 0 }),
  ];

  const orderIn = (list: Moment[], movementId: string | null) =>
    list
      .filter((m) => m.movementId === movementId)
      .sort((a, b) => a.position - b.position)
      .map((m) => m.id);

  it("reorders within a movement", () => {
    const moved = moveMoment(moments, uuid(3), "m1", 0);
    expect(orderIn(moved, "m1")).toEqual([uuid(3), uuid(1), uuid(2)]);
  });

  it("moves a moment between movements and renumbers both densely", () => {
    // Sparse positions survive one move and then drift until two moments claim
    // the same index and the order becomes whatever the database felt like.
    const moved = moveMoment(moments, uuid(2), "m2", 0);
    expect(orderIn(moved, "m2")).toEqual([uuid(2), uuid(4)]);
    expect(orderIn(moved, "m1")).toEqual([uuid(1), uuid(3)]);
    expect(
      moved
        .filter((m) => m.movementId === "m1")
        .map((m) => m.position)
        .sort(),
    ).toEqual([0, 1]);
  });

  it("moves a moment out of every movement", () => {
    const moved = moveMoment(moments, uuid(1), null, 0);
    expect(orderIn(moved, null)).toEqual([uuid(1)]);
    expect(orderIn(moved, "m1")).toEqual([uuid(2), uuid(3)]);
  });

  it("preserves ids and editorial content across a move", () => {
    const rich = moments.map((m) => ({ ...m, purpose: `why ${m.id}`, locked: true }));
    const moved = moveMoment(rich, uuid(1), "m2", 1);
    const found = moved.find((m) => m.id === uuid(1));
    expect(found).toMatchObject({ id: uuid(1), purpose: `why ${uuid(1)}`, locked: true });
    expect(moved).toHaveLength(rich.length);
  });

  it("clamps an index past the end rather than leaving a hole", () => {
    const moved = moveMoment(moments, uuid(4), "m1", 99);
    expect(orderIn(moved, "m1")).toEqual([uuid(1), uuid(2), uuid(3), uuid(4)]);
  });

  it("does nothing for a moment that is not there", () => {
    expect(moveMoment(moments, uuid(77), "m1", 0)).toBe(moments);
  });
});

/* -------------------------------------------------------------------------- */

describe("tracking what changed", () => {
  const before = [moment({ id: uuid(1), title: "One" }), moment({ id: uuid(2), title: "Two" })];

  it("reports nothing for an untouched map", () => {
    expect(
      changedMoments(
        before,
        before.map((m) => ({ ...m })),
      ),
    ).toEqual([]);
  });

  it("reports a moment whose editorial content changed", () => {
    const after = before.map((m) => (m.id === uuid(2) ? { ...m, takeaway: "They act" } : m));
    expect(changedMoments(before, after).map((m) => m.id)).toEqual([uuid(2)]);
  });

  it("reports a moment whose evidence changed", () => {
    const after = before.map((m) =>
      m.id === uuid(1)
        ? { ...m, evidence: [{ kind: "asset" as const, id: uuid(5), label: "x" }] }
        : m,
    );
    expect(changedMoments(before, after).map((m) => m.id)).toEqual([uuid(1)]);
  });

  it("reports a brand-new moment", () => {
    const after = [...before, moment({ id: uuid(3) })];
    expect(changedMoments(before, after).map((m) => m.id)).toEqual([uuid(3)]);
  });

  it("reports a move as a change, so an unsaved reorder cannot be lost", () => {
    const after = moveMoment(before, uuid(2), null, 0);
    expect(changedMoments(before, after).length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("evidence references", () => {
  const available = [
    { kind: "asset" as const, id: uuid(1), label: "Trial results.png" },
    { kind: "note" as const, id: uuid(2), label: "Ward handover" },
  ];

  it("keeps only references the workspace can actually resolve", () => {
    // This is what stops a model inventing a citation by naming a plausible id.
    const result = verifyEvidence([uuid(1), uuid(99)], available);
    expect(result.evidence.map((e) => e.id)).toEqual([uuid(1)]);
    expect(result.dropped).toBe(1);
  });

  it("reports how many were discarded rather than dropping them silently", () => {
    expect(verifyEvidence([uuid(97), uuid(98)], available).dropped).toBe(2);
  });

  it("carries the kind and label from the source, not from the proposal", () => {
    expect(verifyEvidence([uuid(2)], available).evidence[0]).toEqual({
      kind: "note",
      id: uuid(2),
      label: "Ward handover",
    });
  });

  it("does not attach the same source twice", () => {
    expect(verifyEvidence([uuid(1), uuid(1)], available).evidence).toHaveLength(1);
  });

  it("rejects a reference that is not a uuid at the schema boundary", () => {
    const parsed = Moment.safeParse({
      ...moment({ id: uuid(1) }),
      evidence: [{ kind: "asset", id: "../../etc/passwd", label: "x" }],
    });
    expect(parsed.success).toBe(false);
  });
});

/* -------------------------------------------------------------------------- */

describe("drafting a map from a proposal", () => {
  const proposal = ProposedMap.parse({
    title: "Sepsis recognition",
    approach: "Teach the pattern before the protocol.",
    suggestedThemeId: "midnight",
    movements: [
      {
        label: "OPEN",
        title: "Why this matters",
        purpose: "Earn attention.",
        weight: 1,
        moments: [
          {
            title: "The call you remember",
            role: "hook",
            purpose: "Start inside a shift they have worked.",
            takeaway: "This is about my job.",
            visualIntent: "statement",
            weight: 1,
            evidenceIds: [],
          },
        ],
      },
      {
        label: "PROVE",
        title: "Why believe it",
        purpose: "Ground the claim.",
        weight: 1,
        moments: [
          {
            title: "What the audit found",
            role: "evidence",
            purpose: "Show the measurement.",
            takeaway: "The claim is supported.",
            visualIntent: "data",
            weight: 1,
            evidenceIds: [uuid(1), uuid(64)],
          },
        ],
      },
    ],
  });

  const available = [{ kind: "asset" as const, id: uuid(1), label: "Audit.csv" }];

  it("assigns ids in the application, never taking them from the model", () => {
    const { draft } = draftFromProposal(proposal, {
      presentationId: PRESENTATION,
      totalSeconds: 600,
      available,
    });
    for (const m of [...draft.movements, ...draft.moments]) {
      expect(m.id).toMatch(/^[0-9a-f-]{36}$/);
    }
    expect(new Set(draft.moments.map((m) => m.id)).size).toBe(draft.moments.length);
  });

  it("distributes the requested time across the proposal's weights", () => {
    const { draft } = draftFromProposal(proposal, {
      presentationId: PRESENTATION,
      totalSeconds: 600,
      available,
    });
    expect(draft.moments.reduce((sum, m) => sum + m.estimatedSeconds, 0)).toBe(600);
  });

  it("drops evidence the workspace does not hold and says how much", () => {
    const { draft, droppedEvidence } = draftFromProposal(proposal, {
      presentationId: PRESENTATION,
      totalSeconds: 600,
      available,
    });
    expect(droppedEvidence).toBe(1);
    expect(draft.moments[1].evidence.map((e) => e.id)).toEqual([uuid(1)]);
  });

  it("reuses an existing movement's id where the proposal keeps its label", () => {
    // The rail, the scenes filed under it and its stored purpose all survive a
    // regeneration; a movement that genuinely changed becomes a new one.
    const existing = movement(uuid(20), "open", 0);
    const { draft } = draftFromProposal(proposal, {
      presentationId: PRESENTATION,
      totalSeconds: 600,
      available,
      merge: { locked: [], movements: [existing] },
    });
    expect(draft.movements[0].id).toBe(uuid(20));
    expect(draft.movements[0].createdAt).toBe(existing.createdAt);
    expect(draft.movements[1].id).not.toBe(uuid(20));
  });

  it("never replaces a locked moment", () => {
    const locked = moment({
      id: uuid(30),
      movementId: uuid(20),
      locked: true,
      title: "Mine, hands off",
      purpose: "The author wrote this.",
    });
    const { draft } = draftFromProposal(proposal, {
      presentationId: PRESENTATION,
      totalSeconds: 600,
      available,
      merge: { locked: [locked], movements: [movement(uuid(20), "OPEN", 0)] },
    });

    const kept = draft.moments.find((m) => m.id === uuid(30));
    expect(kept).toMatchObject({ title: "Mine, hands off", locked: true, movementId: uuid(20) });
  });

  it("rehomes a locked moment whose movement the proposal removed", () => {
    const locked = moment({ id: uuid(30), movementId: uuid(88), locked: true });
    const { draft } = draftFromProposal(proposal, {
      presentationId: PRESENTATION,
      totalSeconds: 600,
      available,
      merge: { locked: [locked], movements: [] },
    });
    const kept = draft.moments.find((m) => m.id === uuid(30));
    expect(kept?.movementId).toBe(draft.movements[0].id);
  });

  it("numbers moments from zero inside each movement", () => {
    const { draft } = draftFromProposal(proposal, {
      presentationId: PRESENTATION,
      totalSeconds: 600,
      available,
    });
    for (const mv of draft.movements) {
      const own = draft.moments.filter((m) => m.movementId === mv.id);
      expect(own.map((m) => m.position)).toEqual(own.map((_, i) => i));
    }
  });

  it("produces moments that satisfy the stored schema", () => {
    const { draft } = draftFromProposal(proposal, {
      presentationId: PRESENTATION,
      totalSeconds: 600,
      available,
    });
    for (const m of draft.moments) expect(Moment.safeParse(m).success).toBe(true);
  });
});

/* -------------------------------------------------------------------------- */

describe("briefing scene generation", () => {
  const movements = [movement("m1", "OPEN", 0), movement("m2", "PROVE", 1)];
  const moments = [
    moment({ id: uuid(1), movementId: "m1", position: 0, title: "First" }),
    moment({ id: uuid(2), movementId: "m1", position: 1, title: "Second" }),
    moment({ id: uuid(3), movementId: "m2", position: 0, title: "Third" }),
  ];

  it("flattens the map in presentation order", () => {
    expect(briefsFor(movements, moments).map((b) => b.title)).toEqual(["First", "Second", "Third"]);
  });

  it("tells each moment where the room has just been and where it is going", () => {
    const briefs = briefsFor(movements, moments);
    expect(briefs[1]).toMatchObject({ previousTitle: "First", nextTitle: "Third" });
    expect(briefs[0].previousTitle).toBeNull();
    expect(briefs.at(-1)?.nextTitle).toBeNull();
  });

  it("marks the moment that has to carry the room into the next movement", () => {
    const briefs = briefsFor(movements, moments);
    expect(briefs[0].endsMovement).toBe(false);
    expect(briefs[1]).toMatchObject({ endsMovement: true, nextMovementLabel: "PROVE" });
    // The last moment of the talk ends its movement but leads nowhere.
    expect(briefs[2]).toMatchObject({ endsMovement: true, nextMovementLabel: null });
  });

  it("still briefs a moment with no movement, and puts it last", () => {
    const loose = moment({ id: uuid(9), movementId: null, title: "Loose" });
    const briefs = briefsFor(movements, [...moments, loose]);
    expect(briefs.at(-1)).toMatchObject({ title: "Loose", movementLabel: "Unplaced" });
  });

  it("carries the movement's own purpose into every brief under it", () => {
    const withPurpose = [{ ...movements[0], purpose: "Earn attention." }, movements[1]];
    expect(briefsFor(withPurpose, moments)[0].movementPurpose).toBe("Earn attention.");
  });
});

/* -------------------------------------------------------------------------- */

describe("visual intent to layout", () => {
  it("honours an explicit intent over the role", () => {
    expect(layoutFor("comparison", "close", 3)).toBe("two-column");
    expect(layoutFor("data", "hook", 0)).toBe("chart");
    expect(layoutFor("quotation", "evidence", 1)).toBe("quote");
  });

  it("falls back to the role where the author let Captivate choose", () => {
    // A close is a call to action, not a list of what was said; evidence
    // alternates one number with a chart (see point-routing.test.ts).
    expect(layoutFor("auto", "close", 4)).toBe("action");
    expect(layoutFor("auto", "evidence", 3)).toBe("chart");
    expect(layoutFor("auto", "transition", 2)).toBe("section");
  });

  it("opens with a cover at the very start, and only there", () => {
    expect(layoutFor("auto", "hook", 0)).toBe("cover");
    expect(layoutFor("auto", "hook", 5)).toBe("statement");
  });

  it("alternates a demonstration's side so two in a row do not mirror", () => {
    expect(layoutFor("demonstration", "example", 0)).toBe("split-right");
    expect(layoutFor("demonstration", "example", 1)).toBe("split-left");
  });

  it("returns a layout for every role", () => {
    for (const role of ROLE_ORDER) expect(layoutFor("auto", role, 1).length).toBeGreaterThan(0);
  });
});

/* -------------------------------------------------------------------------- */

describe("a map without a language model", () => {
  it("picks an argument form from the request rather than one skeleton for everything", () => {
    expect(chooseShape("A lecture for student paramedics on sepsis").id).toBe("teaching");
    expect(chooseShape("Pitch to the board for budget approval").id).toBe("persuasion");
    expect(chooseShape("Quarterly findings review for the leadership").id).toBe("briefing");
  });

  it("produces different maps for a lecture and a pitch", () => {
    const lecture = fallbackMap("A lecture on sepsis", "Sepsis", null);
    const pitch = fallbackMap("A pitch to investors", "Series A", null);
    expect(lecture.movements.map((m) => m.label)).not.toEqual(pitch.movements.map((m) => m.label));
  });

  it("gives every beat a stated purpose and takeaway", () => {
    const map = fallbackMap("A lecture on sepsis", "Sepsis", "sepsis");
    for (const movement of map.movements) {
      for (const moment of movement.moments) {
        expect(moment.purpose.length).toBeGreaterThan(0);
        expect(moment.takeaway.length).toBeGreaterThan(0);
      }
    }
  });

  it("weaves the topic into purposes, not into beat titles", () => {
    // "Focus on sepsis" reads naturally in a purpose line and reads as keyword
    // soup in a title.
    const map = fallbackMap("A lecture", "Sepsis", "sepsis");
    expect(map.movements[0].purpose).toContain("sepsis");
    for (const movement of map.movements) {
      for (const moment of movement.moments) expect(moment.title).not.toContain("sepsis");
    }
  });

  it("says plainly that it was built without a model", () => {
    expect(fallbackMap("A lecture", "Sepsis", null).approach).toMatch(/without a language model/i);
  });

  it("produces a proposal the draft step accepts", () => {
    const map = ProposedMap.parse(fallbackMap("A lecture on sepsis", "Sepsis", "sepsis"));
    const { draft } = draftFromProposal(map, {
      presentationId: PRESENTATION,
      totalSeconds: 900,
      available: [],
    });
    expect(draft.moments.reduce((sum, m) => sum + m.estimatedSeconds, 0)).toBe(900);
    for (const m of draft.moments) expect(Moment.safeParse(m).success).toBe(true);
  });
});
