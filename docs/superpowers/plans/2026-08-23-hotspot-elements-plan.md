# Clickable Hotspot Elements Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a presenter click a specific whole element on a scene to fly the camera to an associated detail scene, then retrace that dive on "back" — without disturbing the existing whole-stage advance/back click, the linear scene sequence's counts, or the movement rail.

**Architecture:** A `hotspot` field on `elementBase` (content schema, inside the existing `content` JSONB) referencing a target scene id; a new `flowRole` column on `Scene` (`main` | `detail`) excluding detail scenes from the ordinary sequence; a `divePath` stack in the present-mode session store for dive/return; the existing `PresentMessage` protocol extended additively with a `protocolVersion` field and `divePath`; present-mode-only click/keyboard handling in the stage renderer that stops propagation before the whole-stage advance handler sees it.

**Tech Stack:** Next.js 16 Server Actions, Zod schema validation, Zustand present-mode session store, Supabase Postgres (new migration, no new RLS policy — existing owner-scoped `scenes` policies already cover a new column), Vitest + Testing Library, Playwright `lifecycle` project for present-mode DOM interaction tests.

## Global Constraints

- `npm run verify` must pass before any task is considered done, per AGENTS.md.
- MVP is whole-element hotspots only — no inline/phrase-level targeting (spec Non-goals).
- No popup/modal/accordion UI, no new box/border drawn around a hotspot element — `stage.tsx`'s `surface="bare"` / "world has no rectangles" rule is unaffected (spec section B).
- `hotspot.targetSceneId` must reject self-targeting at the save boundary; a dangling reference (deleted target) is repaired to `null` on load, not treated as a parse failure.
- Every new interactive control is keyboard-activatable (Enter/Space) and has a non-empty accessible name — never rely on click alone or an empty `aria-label`.
- Migrations are append-only (`supabase/migrations/`); this plan adds exactly one, for `scenes.flow_role`.
- **Test-harness note, now resolved as its own prerequisite PR**: `supabase/tests/run.sh` originally applied only `supabase/migrations/0001_captivate_core.sql`, not every migration in order — without a fix, `npm run test:rls` would never actually see this plan's `flow_role` column, making Task 1's RLS check vacuously pass. This has been extracted into its own real fix (not just described in a plan): PR "fix: RLS test harness applies every migration, not only 0001" (branch `claude/fix-rls-harness-migration-coverage`), verified locally end-to-end (a regression check added to `rls_isolation.test.sql` fails against the old harness, passes against the fixed one; full run confirmed exit 0 / `RLS TESTS PASSED` against a real local Postgres 16). **Merge or rebase onto that branch before starting Task 1** rather than re-deriving the fix here — Task 1's Step 5b below is redundant with it and should be skipped once that prerequisite is in place.

---

### Task 1: `flowRole` on `Scene` — schema and migration

**Files:**
- Modify: `src/lib/schema/presentation.ts:542-560` (`Scene`)
- Modify: `src/lib/data/presentations.ts:117-135` (`toScene`) — read the new column
- Create: `supabase/migrations/0012_scene_flow_role.sql`
- Test: `tests/unit/presentation-schema.test.ts` (extend)

**Interfaces:**
- Produces: `Scene.flowRole: "main" | "detail"`, defaulting to `"main"` — every later task in this plan that touches scene ordering (`session.ts`, `movement-rail.tsx`, `scene-jumper.tsx`) reads this field.

- [ ] **Step 1: Write the failing schema test**

```typescript
// tests/unit/presentation-schema.test.ts — add to the existing file
import { Scene } from "@/lib/schema/presentation";

describe("Scene.flowRole", () => {
  it("defaults to main when absent", () => {
    const parsed = Scene.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      presentationId: "00000000-0000-4000-8000-000000000002",
      sectionId: null,
      position: 0,
      title: "Untitled",
      content: { elements: [], background: { kind: "none" } },
      placement: null,
      momentId: null,
      speakerNotes: "",
      durationSeconds: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.flowRole).toBe("main");
  });

  it("accepts an explicit detail role", () => {
    const parsed = Scene.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      presentationId: "00000000-0000-4000-8000-000000000002",
      sectionId: null,
      position: 0,
      title: "Untitled",
      content: { elements: [], background: { kind: "none" } },
      placement: null,
      momentId: null,
      speakerNotes: "",
      durationSeconds: null,
      flowRole: "detail",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.flowRole).toBe("detail");
  });

  it("rejects an unknown flow role", () => {
    const parsed = Scene.safeParse({
      id: "00000000-0000-4000-8000-000000000001",
      presentationId: "00000000-0000-4000-8000-000000000002",
      sectionId: null,
      position: 0,
      title: "Untitled",
      content: { elements: [], background: { kind: "none" } },
      placement: null,
      momentId: null,
      speakerNotes: "",
      durationSeconds: null,
      flowRole: "nonsense",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    expect(parsed.success).toBe(false);
  });
});
```

Check `SceneContent`'s actual minimal valid shape first — `grep -n "export const SceneContent" -A 10 src/lib/schema/presentation.ts` — and adjust the `content`/`background` fixture above to match exactly if it differs from `{ elements: [], background: { kind: "none" } }`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/presentation-schema.test.ts -t "flowRole"`
Expected: FAIL — `flowRole` isn't a recognized field yet (extra keys may be stripped or the third test may not fail as expected; confirm the *first two* fail on `parsed.data.flowRole` being `undefined`, not `"main"`).

- [ ] **Step 3: Add the field to the `Scene` schema**

Edit `src/lib/schema/presentation.ts:542-559`:

```typescript
export const Scene = z.object({
  id: z.string().uuid(),
  presentationId: z.string().uuid(),
  sectionId: z.string().uuid().nullable(),
  position: z.number().int().min(0),
  title: z.string().max(240),
  content: SceneContent,
  /** Where this scene sits on the world canvas; null until it is placed. */
  placement: ScenePlacement.nullable().default(null),
  /** The narrative moment this scene was generated from, if any. */
  momentId: z.string().uuid().nullable().default(null),
  /** Presenter-only. Never rendered to the audience surface. */
  speakerNotes: z.string().max(20000),
  /** Rehearsal target in seconds; drives the presenter pacing indicator. */
  durationSeconds: z.number().int().min(0).max(7200).nullable(),
  /**
   * Whether this scene is part of the ordinary next/prev sequence ("main") or
   * reachable only via a hotspot dive ("detail"). Every scene defaults to
   * "main" so existing presentations need no migration beyond the column
   * default below.
   */
  flowRole: z.enum(["main", "detail"]).default("main"),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Scene = z.infer<typeof Scene>;
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/presentation-schema.test.ts -t "flowRole"`
Expected: PASS

- [ ] **Step 5: Write the migration**

Create `supabase/migrations/0012_scene_flow_role.sql`:

```sql
-- Whether a scene is part of the ordinary next/prev sequence, or reachable
-- only by a hotspot dive.
--
-- "detail" scenes exist to hold depth on one specific point without forcing
-- every audience through them in the main sequence — the presenter dives in
-- via a hotspot and the return path is a stack (see the hotspot-elements
-- design spec), not a step count. Every existing scene defaults to "main" so
-- this needs no data migration, only a schema one.

alter table public.scenes
  add column if not exists flow_role text not null default 'main';

alter table public.scenes
  drop constraint if exists scenes_flow_role_check;

alter table public.scenes
  add constraint scenes_flow_role_check
  check (flow_role in ('main', 'detail'));

comment on column public.scenes.flow_role is
  'main = part of the ordinary next/prev sequence; detail = reachable only via a hotspot dive.';
```

No RLS policy change needed — `scenes` is already owner-scoped per AGENTS.md's database rule, and this is a new column on an existing table, not a new table.

- [ ] **Step 5b: Fix the RLS test harness to apply every migration, not only `0001`** — **SKIP this step** if `claude/fix-rls-harness-migration-coverage` has already been merged/rebased in (see the Global Constraints note above); this step is preserved for reference only in case that prerequisite hasn't landed yet.

Edit `supabase/tests/run.sh`, replacing the single hardcoded migration application:

```bash
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0001_captivate_core.sql
```

with:

```bash
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
```

Run the existing suite (`./supabase/tests/run.sh`, matching whatever `PGHOST`/`PGPORT`/`PGUSER` values `docs/DATABASE.md` documents) to confirm every migration through this task's new one applies cleanly and the existing cross-user probes still pass. Commit this fix on its own before continuing:

```bash
git add supabase/tests/run.sh
git commit -m "fix: RLS test harness applies every migration, not only 0001"
```

- [ ] **Step 6: Apply the migration locally and regenerate types if the project does so**

Run: `grep -n "generate.*types\|supabase gen types" package.json` to check if there's a `db:types`-style script; if so run it after applying the migration (`supabase migration up` or the project's documented local-dev flow in `docs/DATABASE.md`) so `SceneRow`'s TypeScript type picks up `flow_role`.

- [ ] **Step 7: Read `flow_role` in `toScene`**

Edit `src/lib/data/presentations.ts:117-135` (`toScene`), adding `flowRole: row.flow_role` to the returned `scene` object — check the exact `SceneRow` field name Step 6 generated (`flow_role` in snake_case per Postgres convention, mapped the same way every other column already is in this function) before writing the line.

- [ ] **Step 8: Run the full unit suite**

Run: `npm run test`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/lib/schema/presentation.ts src/lib/data/presentations.ts supabase/migrations/0012_scene_flow_role.sql tests/unit/presentation-schema.test.ts
git commit -m "feat: scenes carry a flowRole distinguishing main sequence from detail"
```

---

### Task 2: `hotspot` on `elementBase` — schema, self-target rejection, dangling-reference repair

**Files:**
- Modify: `src/lib/schema/presentation.ts:176-184` (`elementBase`)
- Modify: `src/lib/schema/presentation.ts:640` area (`parseSceneContent`) — self-target rejection only; dangling-reference repair happens one level up (Task 3), since it needs the full scene list `parseSceneContent` doesn't have.
- Test: `tests/unit/presentation-schema.test.ts` (extend)

**Interfaces:**
- Produces: `SceneElement.hotspot: { targetSceneId: string; label: string } | null`, read by Task 4 (stage rendering) and Task 6 (inspector).
- Consumes: nothing new.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/presentation-schema.test.ts — add to the existing file
import { SceneElement, parseSceneContent } from "@/lib/schema/presentation";

const HEADING = {
  id: "el-1",
  type: "heading" as const,
  frame: { x: 0, y: 0, w: 50, h: 20, rotation: 0 },
  content: [{ text: "Title" }],
};

describe("SceneElement.hotspot", () => {
  it("defaults to null", () => {
    const parsed = SceneElement.safeParse(HEADING);
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.hotspot).toBeNull();
  });

  it("accepts a hotspot pointing at another scene", () => {
    const parsed = SceneElement.safeParse({
      ...HEADING,
      hotspot: { targetSceneId: "00000000-0000-4000-8000-000000000099", label: "See detail" },
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) expect(parsed.data.hotspot?.targetSceneId).toBe(
      "00000000-0000-4000-8000-000000000099",
    );
  });
});
```

Check `Frame`'s actual required shape first — `grep -n "export const Frame" -A 8 src/lib/schema/presentation.ts` — and adjust the `HEADING` fixture's `frame` to match exactly.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/presentation-schema.test.ts -t "hotspot"`
Expected: FAIL — `hotspot` doesn't exist on `elementBase` yet.

- [ ] **Step 3: Add the field to `elementBase`**

Edit `src/lib/schema/presentation.ts:176-184`:

```typescript
const elementBase = {
  id: z.string().min(1).max(64),
  frame: Frame,
  animation: ElementAnimation.prefault({}),
  /** Hidden elements stay in the document but never render on stage. */
  hidden: z.boolean().default(false),
  locked: z.boolean().default(false),
  opacity: z.number().min(0).max(1).default(1),
  /**
   * Clicking this element in present mode flies the camera to the target
   * scene rather than advancing normally. `label` names the accessible
   * control when non-empty; an empty label falls back to a name derived from
   * the target scene's title at render time (see element-view.tsx).
   * `targetSceneId` must not equal the id of the scene this element lives on
   * — checked where the whole scene is validated (parseSceneContent), which
   * has that context and this field-level schema does not.
   */
  hotspot: z
    .object({
      targetSceneId: z.string().min(1).max(64),
      label: z.string().max(120).default(""),
    })
    .nullable()
    .default(null),
};
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/presentation-schema.test.ts -t "hotspot"`
Expected: PASS

- [ ] **Step 5: Write the failing self-target rejection test**

`parseSceneContent` parses one scene's `content` in isolation but is called with the owning scene's id available at the call site (`toScene`, Task 1) — so self-target rejection needs the scene's own id passed in. Check the current signature first:

Run: `grep -n "export function parseSceneContent" -A 5 src/lib/schema/presentation.ts`

```typescript
// tests/unit/presentation-schema.test.ts — add to the existing file
describe("parseSceneContent self-target rejection", () => {
  it("strips a hotspot that targets its own scene", () => {
    const ownSceneId = "00000000-0000-4000-8000-000000000001";
    const raw = {
      elements: [
        {
          ...HEADING,
          hotspot: { targetSceneId: ownSceneId, label: "" },
        },
      ],
      background: { kind: "none" },
    };
    const { content } = parseSceneContent(raw, ownSceneId);
    expect(content.elements[0].hotspot).toBeNull();
  });

  it("leaves a hotspot targeting a different scene untouched", () => {
    const ownSceneId = "00000000-0000-4000-8000-000000000001";
    const otherSceneId = "00000000-0000-4000-8000-000000000002";
    const raw = {
      elements: [{ ...HEADING, hotspot: { targetSceneId: otherSceneId, label: "" } }],
      background: { kind: "none" },
    };
    const { content } = parseSceneContent(raw, ownSceneId);
    expect(content.elements[0].hotspot?.targetSceneId).toBe(otherSceneId);
  });
});
```

- [ ] **Step 6: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/presentation-schema.test.ts -t "self-target"`
Expected: FAIL — `parseSceneContent` doesn't take a second argument yet, and even if called with one, doesn't strip self-targeting hotspots.

- [ ] **Step 7: Update `parseSceneContent`'s signature and add the self-target check**

Read the full current function first — `sed -n '640,700p' src/lib/schema/presentation.ts` — to see its existing salvage loop (the earlier research noted a `salvaged: SceneElement[]` array and per-element `SceneElement.safeParse`). Add an `ownSceneId?: string` parameter, and after the existing per-element parse succeeds, before pushing to `salvaged`, strip a self-targeting hotspot:

```typescript
export function parseSceneContent(
  raw: unknown,
  ownSceneId?: string,
): { content: SceneContent; recovered: boolean } {
  // ... existing setup unchanged ...

  const salvaged: SceneElement[] = [];
  let recovered = false;

  for (const candidate of /* existing source array */) {
    const el = SceneElement.safeParse(candidate);
    if (!el.success) {
      recovered = true;
      continue;
    }
    let element = el.data;
    if (ownSceneId && element.hotspot?.targetSceneId === ownSceneId) {
      element = { ...element, hotspot: null };
      recovered = true;
    }
    salvaged.push(element);
  }

  // ... existing return unchanged, using `salvaged` and `recovered` ...
}
```

(Match this against the function's actual current structure exactly — the snippet above shows the insertion point and logic, not a full replacement; do not remove any existing salvage behavior for other invalid shapes.)

- [ ] **Step 8: Update the one call site (`toScene`, Task 1) to pass the scene's own id**

Edit `src/lib/data/presentations.ts:118` (inside `toScene`):

```typescript
  const { content, recovered } = parseSceneContent(row.content, row.id);
```

- [ ] **Step 9: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/presentation-schema.test.ts -t "self-target"`
Expected: PASS

- [ ] **Step 10: Run the full unit suite**

Run: `npm run test`
Expected: PASS — confirms no other call site of `parseSceneContent` broke from the new optional parameter.

- [ ] **Step 11: Commit**

```bash
git add src/lib/schema/presentation.ts src/lib/data/presentations.ts tests/unit/presentation-schema.test.ts
git commit -m "feat: elements carry an optional hotspot; self-targeting is rejected at parse time"
```

---

### Task 3: Dangling hotspot repair across the full scene list

**Files:**
- Modify: `src/lib/data/presentations.ts:208-239` (`getPresentationDocument`)
- Test: new test in `tests/unit/narrative-persistence.test.ts` or a new `tests/unit/hotspot-repair.test.ts` — check which existing file already covers `getPresentationDocument`-level behavior via `grep -rn "getPresentationDocument" tests/` first and extend that one if it exists.

**Interfaces:**
- Consumes: `Scene.hotspot` (Task 2), `Scene.id`.
- Produces: `getPresentationDocument`'s existing `recoveredScenes: string[]` return value now also includes scenes whose *cross-scene* hotspot reference was repaired, not only scenes whose own content failed to parse.

**Why this can't live in `parseSceneContent`:** that function validates one scene's `content` in isolation (Task 2's self-target check works because the owning scene's id is a single extra parameter) — but "does this target scene still exist" requires the full set of scene ids for the presentation, which only exists once every scene has been loaded. `getPresentationDocument` (`presentations.ts:208`) is the one place that already has all scenes loaded together before returning them.

- [ ] **Step 1: Write the failing test**

First check how existing tests construct a fake Supabase client for this function — `grep -rn "getPresentationDocument\|createClient\|vi.mock.*supabase" tests/unit/*.ts tests/unit/*.tsx | head -20` — and follow that exact mocking pattern rather than inventing a new one. If none exists (this function may only be covered by integration/RLS tests today), add a narrower unit test directly against the repair logic by extracting it as a standalone, separately-testable function in the same step below.

```typescript
// tests/unit/hotspot-repair.test.ts (new — adjust the import if Step 3
// below extracts the logic under a different, more specific name)
import { describe, expect, it } from "vitest";
import { repairDanglingHotspots } from "@/lib/data/presentations";
import type { Scene } from "@/lib/schema/presentation";

function scene(overrides: Partial<Scene>): Scene {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    presentationId: "00000000-0000-4000-8000-000000000000",
    sectionId: null,
    position: 0,
    title: "Untitled",
    content: { elements: [], background: { kind: "none" } },
    placement: null,
    momentId: null,
    speakerNotes: "",
    durationSeconds: null,
    flowRole: "main",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

describe("repairDanglingHotspots", () => {
  it("nulls a hotspot whose target no longer exists", () => {
    const target = scene({ id: "00000000-0000-4000-8000-000000000002" });
    const withDangling = scene({
      id: "00000000-0000-4000-8000-000000000003",
      content: {
        elements: [
          {
            id: "el-1",
            type: "heading",
            frame: { x: 0, y: 0, w: 50, h: 20, rotation: 0 },
            content: [{ text: "T" }],
            hotspot: { targetSceneId: "00000000-0000-4000-8000-000000000999", label: "" },
          },
        ],
        background: { kind: "none" },
      },
    });

    const { scenes, repairedIds } = repairDanglingHotspots([target, withDangling]);
    const repaired = scenes.find((s) => s.id === withDangling.id)!;
    expect(repaired.content.elements[0].hotspot).toBeNull();
    expect(repairedIds).toContain(withDangling.id);
  });

  it("leaves a hotspot pointing at a real scene untouched", () => {
    const target = scene({ id: "00000000-0000-4000-8000-000000000002" });
    const withValid = scene({
      id: "00000000-0000-4000-8000-000000000003",
      content: {
        elements: [
          {
            id: "el-1",
            type: "heading",
            frame: { x: 0, y: 0, w: 50, h: 20, rotation: 0 },
            content: [{ text: "T" }],
            hotspot: { targetSceneId: target.id, label: "" },
          },
        ],
        background: { kind: "none" },
      },
    });

    const { scenes, repairedIds } = repairDanglingHotspots([target, withValid]);
    const untouched = scenes.find((s) => s.id === withValid.id)!;
    expect(untouched.content.elements[0].hotspot?.targetSceneId).toBe(target.id);
    expect(repairedIds).not.toContain(withValid.id);
  });
});
```

(Check `SceneElement`'s exact `frame`/heading shape again as in Task 2 Step 1 before finalizing this fixture.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/hotspot-repair.test.ts`
Expected: FAIL — `repairDanglingHotspots` is not exported yet.

- [ ] **Step 3: Extract and implement `repairDanglingHotspots`, then call it from `getPresentationDocument`**

Add to `src/lib/data/presentations.ts` (near `toScene`, since it operates on the same `Scene` shape):

```typescript
/**
 * A hotspot's target scene can be deleted after the hotspot was authored —
 * `deleteScene` (data/actions.ts) does a plain row delete with no awareness
 * of who might reference it. This repairs any now-dangling reference the
 * same way `parseSceneContent` already salvages other corrupt content: reset
 * to null rather than fail to load the scene.
 */
export function repairDanglingHotspots(scenes: Scene[]): {
  scenes: Scene[];
  repairedIds: string[];
} {
  const validIds = new Set(scenes.map((s) => s.id));
  const repairedIds: string[] = [];

  const repaired = scenes.map((scene) => {
    let changed = false;
    const elements = scene.content.elements.map((element) => {
      if (element.hotspot && !validIds.has(element.hotspot.targetSceneId)) {
        changed = true;
        return { ...element, hotspot: null };
      }
      return element;
    });
    if (!changed) return scene;
    repairedIds.push(scene.id);
    return { ...scene, content: { ...scene.content, elements } };
  });

  return { scenes: repaired, repairedIds };
}
```

Wire it into `getPresentationDocument` (`presentations.ts:225-238`):

```typescript
  const recoveredScenes: string[] = [];
  const scenes = (scenesRes.data as SceneRow[]).map((row) => {
    const { scene, recovered } = toScene(row);
    if (recovered) recoveredScenes.push(scene.id);
    return scene;
  });

  const { scenes: repairedScenes, repairedIds } = repairDanglingHotspots(scenes);
  for (const id of repairedIds) {
    if (!recoveredScenes.includes(id)) recoveredScenes.push(id);
  }

  return {
    presentation: toPresentationRecord(presentationRes.data as PresentationRow),
    sections: (sectionsRes.data as SectionRow[]).map(toSection),
    scenes: repairedScenes,
    moments: (momentsRes.data as MomentRow[]).map(toMoment),
    recoveredScenes,
  };
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/hotspot-repair.test.ts`
Expected: PASS

- [ ] **Step 5: Confirm the editor's existing "recovered content" UI surfaces this repair**

`recoveredScenes` already drives some existing UI (a toast or banner — find it via `grep -rn "recoveredScenes" src/components/ src/app/`). Verify a scene repaired by this new path shows the same notice a scene repaired by `parseSceneContent`'s own salvage does — this task adds no new UI, it reuses what already exists for exactly this purpose.

- [ ] **Step 6: Run full unit suite**

Run: `npm run test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/data/presentations.ts tests/unit/hotspot-repair.test.ts
git commit -m "fix: repair hotspots left dangling by a deleted target scene"
```

---

### Task 4: Protocol version and `divePath` on `PresentMessage`

**Files:**
- Modify: `src/lib/present/protocol.ts:72-151`
- Test: `tests/unit/present.test.ts` (extend — check this file's existing scope first via `grep -n "describe(" tests/unit/present.test.ts`)

**Interfaces:**
- Produces: `PROTOCOL_VERSION` constant; `PresentMessage`'s `state` variant gains `protocolVersion: number` (defaulted) and `divePath: { sceneIndex: number; step: number }[]` (defaulted); `PresentMessage`'s `command` variant's `action` enum gains `"dive"`.
- Consumes: nothing new.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/present.test.ts — add to the existing file
import { PresentMessage, PROTOCOL_VERSION } from "@/lib/present/protocol";

describe("protocol version and divePath", () => {
  it("exports a protocol version", () => {
    expect(typeof PROTOCOL_VERSION).toBe("number");
  });

  it("defaults protocolVersion and divePath on a minimal state message", () => {
    const parsed = PresentMessage.safeParse({
      type: "state",
      sceneIndex: 0,
      step: 0,
      stepsInScene: 1,
      totalScenes: 3,
      startedAt: null,
      sceneEnteredAt: Date.now(),
      paused: false,
      fullscreen: false,
    });
    expect(parsed.success).toBe(true);
    if (parsed.success && parsed.data.type === "state") {
      expect(parsed.data.protocolVersion).toBe(1);
      expect(parsed.data.divePath).toEqual([]);
    }
  });

  it("accepts a non-empty divePath", () => {
    const parsed = PresentMessage.safeParse({
      type: "state",
      sceneIndex: 4,
      step: 0,
      stepsInScene: 1,
      totalScenes: 3,
      startedAt: null,
      sceneEnteredAt: Date.now(),
      paused: false,
      fullscreen: false,
      divePath: [{ sceneIndex: 1, step: 0 }],
    });
    expect(parsed.success).toBe(true);
  });

  it("accepts a dive command", () => {
    const parsed = PresentMessage.safeParse({ type: "command", action: "dive", index: 5 });
    expect(parsed.success).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/present.test.ts -t "protocol version"`
Expected: FAIL — `PROTOCOL_VERSION` isn't exported, `protocolVersion`/`divePath` aren't recognized fields, `"dive"` isn't a valid action.

- [ ] **Step 3: Update `protocol.ts`**

Edit `src/lib/present/protocol.ts`. Add near the top-level exports (after `channelName`, or near `PRESENTER_COLORS` — match the file's existing constant-placement style):

```typescript
/**
 * Bumped when the shape of session state changes in a way a receiver should
 * know about. This spec's `divePath` is the first such change since the
 * `overview`/`establishing` fields were added — those were defaulted rather
 * than versioned because a missing field degrades gracefully on its own.
 * `divePath` is the same shape of change, so it follows the same defaulting
 * pattern; the version number itself is for future changes that can't.
 */
export const PROTOCOL_VERSION = 1;
```

Edit the `state` variant (`protocol.ts:78-108`), adding two fields at the end (after `establishing`, matching the file's existing comment style for additive fields):

```typescript
    establishing: z.string().max(64).nullable().default(null),
    /** See `PROTOCOL_VERSION` above. */
    protocolVersion: z.number().int().default(1),
    /**
     * Scenes + build-steps to return to, most recent last. Non-empty means
     * the presentation is currently inside a hotspot dive. Defaulted like
     * `overview`/`establishing` above, for the same cross-build-version
     * reason.
     */
    divePath: z
      .array(z.object({ sceneIndex: z.number().int().min(0).max(999), step: z.number().int().min(0).max(999) }))
      .max(20)
      .default([]),
  }),
```

Edit the `command` variant's `action` enum (`protocol.ts:113-123`):

```typescript
    action: z.enum([
      "next",
      "prev",
      "goto",
      "first",
      "last",
      "toggle-pause",
      "reset-timer",
      "blank",
      "overview",
      "dive",
    ]),
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/present.test.ts -t "protocol version"`
Expected: PASS

- [ ] **Step 5: Run full unit suite**

Run: `npm run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/lib/present/protocol.ts tests/unit/present.test.ts
git commit -m "feat: protocol version and divePath on PresentMessage, dive command"
```

---

### Task 5: Session store — `flowRole`-aware `next`/`prev`/`first`/`last`, `dive`, `divePath`

**Files:**
- Modify: `src/lib/present/session.ts`
- Test: `tests/unit/present.test.ts` (extend)

**Interfaces:**
- Consumes: `Scene.flowRole` (Task 1), `PresentMessage`'s `protocolVersion`/`divePath`/`"dive"` action (Task 4).
- Produces: `SessionState.divePath: { sceneIndex: number; step: number }[]`; `SessionApi`/`PresentSession` gain `dive: (targetSceneId: string) => void`; `PresentSession.nextScene` becomes flow-role-aware (skips a detail scene when previewing "what's next").

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/present.test.ts — add to the existing file
import { createSession } from "@/lib/present/session";
import type { Scene } from "@/lib/schema/presentation";

function makeScene(id: string, position: number, flowRole: "main" | "detail" = "main"): Scene {
  return {
    id,
    presentationId: "00000000-0000-4000-8000-000000000000",
    sectionId: null,
    position,
    title: `Scene ${position}`,
    content: { elements: [], background: { kind: "none" } },
    placement: null,
    momentId: null,
    speakerNotes: "",
    durationSeconds: null,
    flowRole,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

describe("session flowRole-aware navigation", () => {
  it("next() skips a detail scene", () => {
    const scenes = [
      makeScene("s0", 0, "main"),
      makeScene("s1", 1, "detail"),
      makeScene("s2", 2, "main"),
    ];
    const api = createSession({ presentationId: "p1", scenes, role: "stage" });
    api.send("next");
    expect(api.store.getState().sceneIndex).toBe(2);
  });

  it("prev() skips a detail scene going backward", () => {
    const scenes = [
      makeScene("s0", 0, "main"),
      makeScene("s1", 1, "detail"),
      makeScene("s2", 2, "main"),
    ];
    const api = createSession({ presentationId: "p1", scenes, role: "stage" });
    api.send("goto", 2);
    api.send("prev");
    expect(api.store.getState().sceneIndex).toBe(0);
  });

  it("dive() pushes the current position and jumps to the target", () => {
    const scenes = [makeScene("s0", 0, "main"), makeScene("s1", 1, "detail")];
    const api = createSession({ presentationId: "p1", scenes, role: "stage" });
    api.send("dive", 1);
    const state = api.store.getState();
    expect(state.sceneIndex).toBe(1);
    expect(state.divePath).toEqual([{ sceneIndex: 0, step: 0 }]);
  });

  it("prev() pops divePath before falling back to linear movement", () => {
    const scenes = [
      makeScene("s0", 0, "main"),
      makeScene("s1", 1, "main"),
      makeScene("s2", 2, "detail"),
    ];
    const api = createSession({ presentationId: "p1", scenes, role: "stage" });
    api.send("goto", 1);
    api.send("dive", 2);
    api.send("prev");
    const state = api.store.getState();
    expect(state.sceneIndex).toBe(1);
    expect(state.divePath).toEqual([]);
  });

  it("nested dives pop in LIFO order", () => {
    const scenes = [
      makeScene("s0", 0, "main"),
      makeScene("s1", 1, "detail"),
      makeScene("s2", 2, "detail"),
    ];
    const api = createSession({ presentationId: "p1", scenes, role: "stage" });
    api.send("dive", 1); // s0 -> s1, divePath: [s0]
    api.send("dive", 2); // s1 -> s2, divePath: [s0, s1]
    api.send("prev"); // back to s1, divePath: [s0]
    expect(api.store.getState().sceneIndex).toBe(1);
    api.send("prev"); // back to s0, divePath: []
    expect(api.store.getState().sceneIndex).toBe(0);
    expect(api.store.getState().divePath).toEqual([]);
  });

  it("a mid-build step reverses before divePath pops", () => {
    const scenes = [
      { ...makeScene("s0", 0, "main") },
      {
        ...makeScene("s1", 1, "detail"),
        content: {
          elements: [
            {
              id: "el-1",
              type: "heading" as const,
              frame: { x: 0, y: 0, w: 50, h: 20, rotation: 0 },
              content: [{ text: "T" }],
              animation: { entrance: "fade", delay: 0, duration: 0.5, emphasis: "none", onAdvance: true },
            },
          ],
          background: { kind: "none" },
        },
      },
    ];
    const api = createSession({ presentationId: "p1", scenes, role: "stage" });
    api.send("dive", 1);
    api.send("next"); // reveals the onAdvance element: step 0 -> 1
    expect(api.store.getState().step).toBe(1);
    api.send("prev"); // reverses the step, does NOT pop divePath yet
    expect(api.store.getState().step).toBe(0);
    expect(api.store.getState().divePath).toEqual([{ sceneIndex: 0, step: 0 }]);
    api.send("prev"); // now pops divePath
    expect(api.store.getState().sceneIndex).toBe(0);
    expect(api.store.getState().divePath).toEqual([]);
  });

  it("first()/last() land on the first/last main scene, not literal index 0/length-1", () => {
    const scenes = [
      makeScene("s0", 0, "detail"),
      makeScene("s1", 1, "main"),
      makeScene("s2", 2, "main"),
      makeScene("s3", 3, "detail"),
    ];
    const api = createSession({ presentationId: "p1", scenes, role: "stage" });
    api.send("last");
    expect(api.store.getState().sceneIndex).toBe(2);
    api.send("first");
    expect(api.store.getState().sceneIndex).toBe(1);
  });
});
```

Check `buildStepCount`'s exact export path first — `grep -rn "function buildStepCount" src/lib/present/` — this plan assumes it's in scope already via `session.ts`'s own import, consistent with how `stepCounts` is computed at `session.ts:145` today.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/present.test.ts -t "flowRole-aware navigation"`
Expected: FAIL — no skip logic, no `dive` handling yet.

- [ ] **Step 3: Add the skip helpers and rewrite `next`/`prev`/`goTo`'s callers**

Edit `src/lib/present/session.ts`. Add near the top of `createSession` (after `stepCounts` at line 145), closed over `scenes`:

```typescript
  const isMain = (index: number) => scenes[index]?.flowRole !== "detail";

  /** Next index >= start where the scene is main-flow, or null if none. */
  const nextMainIndex = (start: number): number | null => {
    for (let i = start; i < scenes.length; i += 1) {
      if (isMain(i)) return i;
    }
    return null;
  };

  /** Previous index <= start where the scene is main-flow, or null if none. */
  const prevMainIndex = (start: number): number | null => {
    for (let i = start; i >= 0; i -= 1) {
      if (isMain(i)) return i;
    }
    return null;
  };
```

Rewrite `next` (`session.ts:218-242`):

```typescript
  const next = () =>
    update((current) => {
      const steps = stepCounts[current.sceneIndex] ?? 1;
      // Walk the builds within a scene before moving on to the next scene.
      if (current.step < steps - 1) {
        return {
          step: current.step + 1,
          startedAt: current.startedAt ?? clock(current),
          blanked: false,
          overview: false,
        };
      }
      const nextIndex = nextMainIndex(current.sceneIndex + 1);
      if (nextIndex === null) return { blanked: false, overview: false };

      return {
        sceneIndex: nextIndex,
        step: 0,
        stepsInScene: stepCounts[nextIndex] ?? 1,
        sceneEnteredAt: clock(current),
        startedAt: current.startedAt ?? clock(current),
        blanked: false,
        overview: false,
      };
    });
```

Rewrite `prev` (`session.ts:244-260`) with the three-step precedence from the spec:

```typescript
  const prev = () =>
    update((current) => {
      // 1. Reverse a build step first.
      if (current.step > 0) return { step: current.step - 1, blanked: false, overview: false };

      // 2. Return from a detail branch, if one is open.
      if (current.divePath.length > 0) {
        const popped = current.divePath[current.divePath.length - 1];
        const steps = stepCounts[popped.sceneIndex] ?? 1;
        return {
          sceneIndex: popped.sceneIndex,
          step: Math.max(0, Math.min(steps - 1, popped.step)),
          stepsInScene: steps,
          divePath: current.divePath.slice(0, -1),
          sceneEnteredAt: clock(current),
          blanked: false,
          overview: false,
        };
      }

      // 3. Ordinary linear movement, skipping detail scenes.
      const prevIndex = prevMainIndex(current.sceneIndex - 1);
      if (prevIndex === null) return { blanked: false, overview: false };

      const steps = stepCounts[prevIndex] ?? 1;
      return {
        sceneIndex: prevIndex,
        // Returning to a scene shows it fully built, not rewound.
        step: steps - 1,
        stepsInScene: steps,
        sceneEnteredAt: clock(current),
        blanked: false,
        overview: false,
      };
    });
```

Add `dive`, next to `next`/`prev`:

```typescript
  const dive = (targetIndex: number) =>
    update((current) => {
      const steps = stepCounts[targetIndex] ?? 1;
      return {
        sceneIndex: targetIndex,
        step: 0,
        stepsInScene: steps,
        divePath: [
          ...current.divePath,
          { sceneIndex: current.sceneIndex, step: current.step },
        ].slice(-20), // matches the protocol's divePath max(20)
        sceneEnteredAt: clock(current),
        startedAt: current.startedAt ?? clock(current),
        blanked: false,
        overview: false,
      };
    });
```

Update `apply`'s `"first"`/`"last"` cases (`session.ts:302-307`) to use the skip-aware helpers, and add a `"dive"` case:

```typescript
      case "first": {
        const index = nextMainIndex(0);
        if (index !== null) navigate(() => goTo(index));
        break;
      }
      case "last": {
        const index = prevMainIndex(scenes.length - 1);
        if (index !== null) navigate(() => goTo(index));
        break;
      }
      case "dive":
        if (typeof index === "number") navigate(() => dive(index));
        break;
```

- [ ] **Step 4: Add `divePath` to `SessionState`, `initialState`, `broadcastState`, and the inbound `"state"` handler**

`SessionState` interface (near line 36-81): add `divePath: { sceneIndex: number; step: number }[];` next to `establishing`.

`initialState` (line 94-113): add `divePath: [],`.

`broadcastState` (line 151-170): add `divePath: state.divePath, protocolVersion: PROTOCOL_VERSION,` to the posted message — import `PROTOCOL_VERSION` from `./protocol`.

The inbound `"state"` message handler (around line 405-426, seen partially during planning — confirm exact location via `grep -n '"state"' src/lib/present/session.ts`): add `divePath: message.divePath,` — note `message.divePath` defaults to `[]` per Task 4's schema default, so an older sender simply produces an empty array here, which is the correct "not diving" state for a console that predates this feature.

- [ ] **Step 5: Expose `dive` and fix `nextScene` on the public `usePresentSession` API**

Edit the `PresentSession` interface (near line 495) to add `dive: (targetSceneId: string) => void;` and `divePath: { sceneIndex: number; step: number }[];`.

Edit `usePresentSession`'s returned object (`session.ts:535-565`): add `divePath: state.divePath,` next to `establishing`, and change `nextScene`:

```typescript
      scene: scenes[state.sceneIndex] ?? null,
      nextScene: (() => {
        const idx = nextMainIndexInScenes(scenes, state.sceneIndex + 1);
        return idx === null ? null : scenes[idx];
      })(),
```

This needs a standalone (non-closure) version of `nextMainIndex` usable outside `createSession`, since `usePresentSession`'s returned-object computation is outside `api`'s closure. Add a small exported helper near the top of the file (used by both `createSession` internally and here):

```typescript
/** Exported for `usePresentSession`'s `nextScene` preview, outside createSession's closure. */
export function nextMainIndexInScenes(scenes: Scene[], start: number): number | null {
  for (let i = start; i < scenes.length; i += 1) {
    if (scenes[i]?.flowRole !== "detail") return i;
  }
  return null;
}
```

And refactor `createSession`'s internal `nextMainIndex` (Step 3) to call this shared helper instead of duplicating the loop:

```typescript
  const nextMainIndex = (start: number) => nextMainIndexInScenes(scenes, start);
```

Add `dive: (targetSceneId: string) => { const idx = scenes.findIndex((s) => s.id === targetSceneId); if (idx >= 0) api.send("dive", idx); },` to the returned object, next to `goto`.

- [ ] **Step 6: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/present.test.ts`
Expected: PASS (the full file, not just the new describe block — confirm nothing existing broke)

- [ ] **Step 7: Run full unit suite**

Run: `npm run test`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/lib/present/session.ts tests/unit/present.test.ts
git commit -m "feat: flowRole-aware next/prev/first/last, dive, and divePath in the session store"
```

---

### Task 6: `movementsOf` excludes detail scenes; `totalScenes`/progress reflect main scenes only

**Files:**
- Modify: `src/components/present/movement-rail.tsx:37-62` (`movementsOf`)
- Modify: `src/lib/present/session.ts` (`totalScenes` computation)
- Test: `tests/unit/movements.test.ts` (extend)

**Interfaces:**
- Consumes: `Scene.flowRole`.
- Produces: `movementsOf`'s existing return type (`Movement[]`) unchanged in shape — only which scenes count toward a span changes.

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/movements.test.ts — add to the existing file
import { movementsOf } from "@/components/present/movement-rail";
// reuse makeScene / a local equivalent matching this file's existing fixture style — check first

describe("movementsOf excludes detail scenes", () => {
  it("does not fragment a movement when a detail scene sits inside it", () => {
    const sectionId = "00000000-0000-4000-8000-000000000010";
    const sections = [{ id: sectionId, presentationId: "p1", position: 0, title: "Open", label: "OPEN" }];
    const scenes = [
      makeScene("s0", 0, sectionId, "main"),
      makeScene("s1", 1, sectionId, "detail"),
      makeScene("s2", 2, sectionId, "main"),
    ];
    const movements = movementsOf(scenes, sections);
    expect(movements).toHaveLength(1);
    expect(movements[0].start).toBe(0);
    expect(movements[0].end).toBe(3); // still spans the full index range...
  });
});
```

Before finalizing this test, re-read `movementsOf`'s exact `start`/`end` semantics (`movement-rail.tsx:37-62`) against the planned "skip via early return" change in Step 3 below — a skipped index must NOT extend `current.end` either, since `end` is used as an exclusive upper bound elsewhere. Adjust the assertion to whatever the correct post-fix `end` value is (likely still 3, since scene s2 at index 2 extends `end` to 3 regardless of s1 being skipped in between — confirm by tracing the loop by hand before trusting this fixture) and adjust `Movement`'s local test fixture builder (`makeScene`) to accept a `flowRole` parameter, matching Task 5's fixture shape — check whether `tests/unit/movements.test.ts` already has its own `makeScene`-equivalent (likely does, given this file predates this plan) and extend that one rather than duplicating a second helper of the same name in the same file.

- [ ] **Step 2: Run the test to verify it fails or passes for the wrong reason**

Run: `npx vitest run tests/unit/movements.test.ts -t "excludes detail scenes"`
Expected: Before Step 3's fix, a detail scene with no `sectionId` (or a different one from its neighbors) would incorrectly start a *new* movement — adjust the test fixture to specifically exercise that case (a detail scene between two main scenes of the *same* section, since that is the fragmentation risk the spec calls out) and confirm it currently fails by producing 2+ movements instead of 1.

- [ ] **Step 3: Add the skip to `movementsOf`**

Edit `src/components/present/movement-rail.tsx:37-62`:

```typescript
export function movementsOf(scenes: Scene[], sections: Section[]): Movement[] {
  const byId = new Map(sections.map((section) => [section.id, section]));
  const movements: Movement[] = [];

  scenes.forEach((scene, index) => {
    if (scene.flowRole === "detail") return;

    const current = movements[movements.length - 1];
    const id = scene.sectionId ?? "";

    if (current && current.id === id) {
      current.end = index + 1;
      return;
    }

    const section = scene.sectionId ? byId.get(scene.sectionId) : undefined;
    movements.push({
      id,
      label: section ? section.label.trim() || section.title.trim() : "",
      start: index,
      end: index + 1,
    });
  });

  return movements;
}
```

(Single added line: `if (scene.flowRole === "detail") return;` at the top of the loop body — everything else is unchanged.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/movements.test.ts -t "excludes detail scenes"`
Expected: PASS

- [ ] **Step 5: Write the failing test for `totalScenes`**

```typescript
// tests/unit/present.test.ts — add to the existing file
describe("totalScenes counts only main scenes", () => {
  it("excludes detail scenes from the initial totalScenes", () => {
    const scenes = [
      makeScene("s0", 0, "main"),
      makeScene("s1", 1, "detail"),
      makeScene("s2", 2, "main"),
    ];
    const api = createSession({ presentationId: "p1", scenes, role: "stage" });
    expect(api.store.getState().totalScenes).toBe(2);
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run tests/unit/present.test.ts -t "totalScenes counts only main"`
Expected: FAIL — `totalScenes` is currently `scenes.length` (3), not the main-only count (2).

- [ ] **Step 7: Fix every `totalScenes: scenes.length` occurrence in `session.ts`**

Run: `grep -n "totalScenes: scenes.length" src/lib/present/session.ts` to find every occurrence (the earlier research noted three: `initialState`, and inside `goTo`'s returned patch). Replace each with a call to a small helper added once near the top of the file:

```typescript
const mainSceneCount = (scenes: Scene[]) => scenes.filter((s) => s.flowRole !== "detail").length;
```

`initialState(scenes, stepCounts)` (line 94-113): `totalScenes: mainSceneCount(scenes),`. `goTo`'s returned patch (line 210): `totalScenes: mainSceneCount(scenes),` (this one is redundant with `initialState` in practice since `totalScenes` never actually changes after creation — but matching the existing pattern exactly, rather than removing what's there today, keeps this change minimal and behaviorally identical to today aside from the fix itself).

- [ ] **Step 8: Run the test to verify it passes**

Run: `npx vitest run tests/unit/present.test.ts -t "totalScenes counts only main"`
Expected: PASS

- [ ] **Step 9: Run full unit suite**

Run: `npm run test`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/components/present/movement-rail.tsx src/lib/present/session.ts tests/unit/movements.test.ts tests/unit/present.test.ts
git commit -m "fix: movements and totalScenes exclude detail scenes"
```

---

### Task 7: Scene-jumper lists only main-flow scenes

**Files:**
- Modify: `src/components/present/scene-jumper.tsx:52-65` area (`searchable`)
- Test: check for an existing `scene-jumper` test file (`grep -rln "SceneJumper" tests/unit/`); extend it if found, otherwise add a focused test inline per this task.

**Interfaces:** none new — filters an existing internal computation.

- [ ] **Step 1: Write the failing test**

If no existing test file covers `SceneJumper`, create `tests/unit/scene-jumper.test.tsx`:

```typescript
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SceneJumper } from "@/components/present/scene-jumper";
// reuse a Scene fixture builder consistent with earlier tasks

describe("SceneJumper", () => {
  it("does not list detail scenes", () => {
    const scenes = [
      makeScene("s0", 0, null, "main", "Opening"),
      makeScene("s1", 1, null, "detail", "Hidden detail"),
    ];
    render(
      <SceneJumper
        open
        onClose={() => {}}
        scenes={scenes}
        sections={[]}
        currentIndex={0}
        onSelect={() => {}}
        title="Test deck"
      />,
    );
    expect(screen.getByText("Opening")).toBeInTheDocument();
    expect(screen.queryByText("Hidden detail")).not.toBeInTheDocument();
  });
});
```

(Adjust the `makeScene` signature to whatever shape this file's fixtures actually need — it must produce a real `title` distinguishable in the rendered grid.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/scene-jumper.test.tsx`
Expected: FAIL — both scenes currently render.

- [ ] **Step 3: Filter `searchable` to main-flow scenes**

Edit `src/components/present/scene-jumper.tsx:52-65`:

```typescript
  const searchable = useMemo(
    () =>
      scenes
        .map((scene, index) => ({
          index,
          scene,
          text: [
            scene.title,
            // ... existing text-extraction logic unchanged ...
          ]
            .filter(Boolean)
            .join(" ")
            .toLowerCase(),
        }))
        .filter(({ scene }) => scene.flowRole !== "detail"),
    [scenes],
  );
```

(Insert `.filter(({ scene }) => scene.flowRole !== "detail")` as the last step of the existing chain — map first so `index` stays the true index into the full array, matching `onSelect(index)`'s existing contract of an index into `scenes` as passed to the component, unchanged from today.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/scene-jumper.test.tsx`
Expected: PASS

- [ ] **Step 5: Run full unit suite**

Run: `npm run test`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/components/present/scene-jumper.tsx tests/unit/scene-jumper.test.tsx
git commit -m "fix: scene jumper only lists main-flow scenes"
```

---

### Task 8: Stage rendering — hotspot click/keyboard target, accessible name fallback

**Files:**
- Modify: `src/components/stage/stage.tsx` (`StageProps`, `Stage`, `ElementLayer`)
- Test: `tests/unit/stage-render.test.tsx` (extend)

**Interfaces:**
- Produces: `StageProps.onHotspot?: (targetSceneId: string) => void` — undefined in editor/thumbnail contexts (hotspot clicks there mean "select the element," handled by whatever the editor canvas already does, unchanged), present in present mode.
- Consumes: `SceneElement.hotspot` (Task 2), `Scene.title` (for the accessible-name fallback, passed in as a lookup).

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/stage-render.test.tsx — add to the existing file
import { fireEvent, render, screen } from "@testing-library/react";
import { Stage } from "@/components/stage/stage";
// reuse this file's existing theme/content fixtures

describe("hotspot elements", () => {
  const contentWithHotspot = {
    elements: [
      {
        id: "el-1",
        type: "heading" as const,
        frame: { x: 10, y: 10, w: 40, h: 20, rotation: 0 },
        content: [{ text: "Click me" }],
        hotspot: { targetSceneId: "target-1", label: "" },
      },
    ],
    background: { kind: "none" as const },
  };

  it("fires onHotspot with the target id when clicked, in present mode only", () => {
    const onHotspot = vi.fn();
    render(
      <Stage
        content={contentWithHotspot}
        theme={TEST_THEME} // reuse whatever this file's existing theme fixture is called
        aspect="16:9"
        onHotspot={onHotspot}
        sceneTitleFor={(id) => (id === "target-1" ? "Detail scene" : "")}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Detail scene/i }));
    expect(onHotspot).toHaveBeenCalledWith("target-1");
  });

  it("does not render an interactive control when onHotspot is absent (editor context)", () => {
    render(
      <Stage content={contentWithHotspot} theme={TEST_THEME} aspect="16:9" />,
    );
    expect(screen.queryByRole("button", { name: /Detail scene/i })).not.toBeInTheDocument();
  });

  it("falls back to a deterministic accessible name when label is empty", () => {
    render(
      <Stage
        content={contentWithHotspot}
        theme={TEST_THEME}
        aspect="16:9"
        onHotspot={() => {}}
        sceneTitleFor={() => "My Target Scene"}
      />,
    );
    expect(screen.getByRole("button", { name: /My Target Scene/i })).toBeInTheDocument();
  });

  it("is keyboard-activatable", () => {
    const onHotspot = vi.fn();
    render(
      <Stage
        content={contentWithHotspot}
        theme={TEST_THEME}
        aspect="16:9"
        onHotspot={onHotspot}
        sceneTitleFor={() => "Detail scene"}
      />,
    );
    const control = screen.getByRole("button", { name: /Detail scene/i });
    control.focus();
    fireEvent.keyDown(control, { key: "Enter" });
    expect(onHotspot).toHaveBeenCalledWith("target-1");
  });
});
```

Check this test file's existing theme/content fixture names (`grep -n "const TEST_THEME\|import.*from.*stage-render" tests/unit/stage-render.test.tsx | head -5`) and use those exactly instead of inventing `TEST_THEME`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/stage-render.test.tsx -t "hotspot"`
Expected: FAIL — `onHotspot`/`sceneTitleFor` props don't exist yet.

- [ ] **Step 3: Add the props and wire them through `ElementLayer`**

Edit `StageProps` (`stage.tsx:25-53`), adding:

```typescript
  /**
   * Present-mode only. When set, an element with a `hotspot` becomes a real
   * interactive control that calls this with the target scene id instead of
   * being purely decorative. Absent in the editor canvas and thumbnails —
   * there, clicking an element means "select it," never "dive."
   */
  onHotspot?: (targetSceneId: string) => void;
  /** Resolves a scene id to its title, for the accessible-name fallback when `hotspot.label` is empty. */
  sceneTitleFor?: (sceneId: string) => string;
```

Thread both through to `ElementLayer` in the `content.elements.map(...)` call (`stage.tsx:167-179`):

```typescript
        {content.elements.map((element, index) => (
          <ElementLayer
            key={element.id}
            element={element}
            theme={theme}
            stageWidth={size.width}
            stageHeight={size.height}
            play={play && !reduced}
            step={step}
            index={index}
            elements={content.elements}
            onHotspot={onHotspot}
            sceneTitleFor={sceneTitleFor}
          />
        ))}
```

Edit `ElementLayer` (`stage.tsx:225-305`) to accept the two new props and render the hotspot control. The existing outer `<motion.div style={style} ...>` already has the correct absolute position/size for the element's full hit area — add the interactive attributes there when `element.hotspot` and `onHotspot` are both present:

```typescript
function ElementLayer({
  element,
  theme,
  stageWidth,
  stageHeight,
  play,
  step,
  index,
  elements,
  onHotspot,
  sceneTitleFor,
}: {
  element: SceneElement;
  theme: PresentationTheme;
  stageWidth: number;
  stageHeight: number;
  play: boolean;
  step: number;
  index: number;
  elements: SceneElement[];
  onHotspot?: (targetSceneId: string) => void;
  sceneTitleFor?: (sceneId: string) => string;
}) {
  if (element.hidden) return null;

  // ... existing gated/from/to/style/emphasis computation unchanged ...

  const hotspot = element.hotspot && onHotspot ? element.hotspot : null;
  const accessibleName = hotspot
    ? hotspot.label.trim() || `Expand: ${sceneTitleFor?.(hotspot.targetSceneId) ?? ""}`.trim()
    : undefined;

  const hotspotProps = hotspot
    ? {
        role: "button" as const,
        tabIndex: 0,
        "aria-label": accessibleName,
        onClick: (e: React.MouseEvent) => {
          e.stopPropagation();
          onHotspot!(hotspot.targetSceneId);
        },
        onKeyDown: (e: React.KeyboardEvent) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            e.stopPropagation();
            onHotspot!(hotspot.targetSceneId);
          }
        },
        style: { cursor: "pointer" },
      }
    : {};

  return (
    <motion.div
      style={style}
      initial={play ? { ...from, opacity: (from.opacity ?? 1) * element.opacity } : false}
      animate={
        play
          ? { ...to, opacity: element.opacity, ...(emphasis ?? {}) }
          : { opacity: element.opacity }
      }
      transition={{
        duration: element.animation.duration,
        delay: element.animation.onAdvance ? 0 : element.animation.delay,
        ease: STAGE_EASE,
      }}
      {...hotspotProps}
    >
      <StaggeredElement
        element={element}
        theme={theme}
        stageWidth={stageWidth}
        stageHeight={stageHeight}
        step={step}
        play={play}
      />
      {hotspot && (
        <span
          aria-hidden
          style={{
            position: "absolute",
            bottom: 6,
            right: 6,
            width: 18,
            height: 18,
            borderRadius: 9999,
            background: "color-mix(in oklab, var(--stage-accent) 88%, transparent)",
            pointerEvents: "none",
          }}
        />
      )}
    </motion.div>
  );
}
```

(The glyph is a small dot, not a rectangle around the element — per the spec's "no rectangle" rule. Refine its exact icon/shape during visual verification in Step 6; the placement/non-blocking `pointerEvents: "none"` and its position *inside* the element's own bounds, not around them, are the load-bearing parts of this step, not its exact glyph.)

Note the `style={{ position: "absolute", ...existing style, cursor: "pointer" }}` merge: `hotspotProps.style` above only sets `cursor`, and since it's spread *after* the `style` prop already set on `<motion.div style={style} ...>`... check carefully: JSX prop spread order means `{...hotspotProps}` after `style={style}` would **replace**, not merge, `style` if `hotspotProps` includes a `style` key. Fix by merging explicitly instead of relying on spread order:

```typescript
    <motion.div
      style={hotspot ? { ...style, cursor: "pointer" } : style}
      // ...
      {...(hotspot
        ? {
            role: "button" as const,
            tabIndex: 0,
            "aria-label": accessibleName,
            onClick: (e: React.MouseEvent) => {
              e.stopPropagation();
              onHotspot!(hotspot.targetSceneId);
            },
            onKeyDown: (e: React.KeyboardEvent) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                e.stopPropagation();
                onHotspot!(hotspot.targetSceneId);
              }
            },
          }
        : {})}
    >
```

(This replaces the two-step `hotspotProps` object above — use this merged form, not both.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/stage-render.test.tsx -t "hotspot"`
Expected: PASS

- [ ] **Step 5: Run full unit suite**

Run: `npm run test`
Expected: PASS

- [ ] **Step 6: Visual verification**

Via the `run` skill: author an element with a hotspot (once Task 9's inspector UI exists — this step may need to be revisited after Task 9, or exercised by temporarily setting `hotspot` via a direct database edit if done before it), present, confirm the glyph renders inside the element's bounds without a surrounding box, confirm clicking it dives without also advancing the scene, confirm Tab reaches it and Enter/Space activates it.

- [ ] **Step 7: Commit**

```bash
git add src/components/stage/stage.tsx tests/unit/stage-render.test.tsx
git commit -m "feat: hotspot elements are real interactive controls in present mode"
```

---

### Task 9: Wire `dive` from `present-root.tsx`; confirm whole-stage click is not also triggered

**Files:**
- Modify: `src/components/present/present-root.tsx`
- Test: new Playwright `lifecycle` spec, or a `tests/unit/present-load-boundary.test.tsx`-style component test — check which this codebase already uses for present-root-level interaction coverage (`grep -n "present-root\|advanceOnClick" tests/unit/*.tsx tests/e2e/*.ts`) and follow that file's existing pattern.

**Interfaces:**
- Consumes: `Stage`'s `onHotspot` (Task 8), `session.dive` (Task 5).

- [ ] **Step 1: Wire `Stage`'s `onHotspot` to `session.dive` in `present-root.tsx`**

Find the `<Stage .../>` or `<World .../>` render (present mode renders through `World`, which itself renders `Stage` per-scene internally — check `grep -n "onHotspot\|<Stage\b" src/components/stage/world.tsx` to confirm whether `World` needs the same prop threaded one level further, since `present-root.tsx` renders `<World .../>`, not `<Stage/>` directly per the earlier-read code at `present-root.tsx:251-266`).

If `World` renders `Stage` internally per scene, thread `onHotspot`/`sceneTitleFor` through `World`'s own props the same way `showPath`/`onSceneSelect` already are (`present-root.tsx:263-265`):

```typescript
      <World
        scenes={scenes}
        placements={placements}
        theme={theme}
        aspect={presentation.aspectRatio}
        focus={focus}
        activeIndex={session.sceneIndex}
        step={session.step}
        play
        travel={journey.travel}
        pace={journey.pace}
        depth={journey.depth}
        showPath={journey.showPath && session.overview}
        className="absolute inset-0"
        onSceneSelect={session.overview && !audienceOnly ? session.goto : undefined}
        onHotspot={!audienceOnly && !session.overview ? session.dive : undefined}
        sceneTitleFor={(id) => scenes.find((s) => s.id === id)?.title ?? ""}
      />
```

(`onHotspot` is disabled in `audienceOnly` mode — consistent with `onSceneSelect` already being presenter-only — and disabled during `overview`, since diving while pulled back over the whole world doesn't make sense as an interaction; re-enable it only once `World`'s per-scene `Stage` instances are confirmed to still render at overview scale, which they should, but the interaction doesn't.)

Then in `world.tsx`, thread `onHotspot`/`sceneTitleFor` down to each per-scene `<Stage .../>` it renders internally — find that render via `grep -n "<Stage\b" src/components/stage/world.tsx` and pass both props straight through, matching whatever prop-threading pattern `world.tsx` already uses for scene-level interaction (likely similar to how it already passes `onClick={onSceneSelect ? () => onSceneSelect(index) : undefined}` at the wrapping `<div>` level per the earlier research — confirm `Stage` is rendered as a child of that div, not the div itself, before deciding exactly where `onHotspot` plugs in).

- [ ] **Step 2: Write the failing interaction test — hotspot click does not also advance**

```typescript
// Following whichever pattern Task 9's Step "check which file" step above found —
// shown here as a Testing Library component test against PresentRoot; adapt to
// Playwright lifecycle conventions if that is this codebase's established pattern
// for present-mode interaction coverage instead.
it("clicking a hotspot dives without also advancing the whole-stage scene", () => {
  // Render PresentRoot (or World, whichever is the narrowest component that
  // reproduces both the whole-stage advanceOnClick handler and a per-element
  // hotspot in one tree) with a scene containing a hotspot element and a
  // second, detail scene as its target.
  // ... fixture setup matching this file's existing PresentRoot/World test
  // conventions ...

  fireEvent.click(screen.getByRole("button", { name: /Expand|Detail/i }));

  // The scene must have changed to the dive target, not merely advanced by one.
  expect(/* session sceneIndex or rendered scene title */).toBe(/* target scene */);
  // And critically: it must NOT have also incremented as if the whole-stage
  // click had fired — assert this by checking sceneIndex is exactly the dive
  // target's index, not target index + 1 or some other value implying both
  // handlers ran.
});
```

- [ ] **Step 3: Run the test to verify it fails (if `stopPropagation` in Task 8 has a gap) or passes**

Run the relevant test command for whichever file Step 2 was added to.
Expected: if Task 8's `e.stopPropagation()` inside the hotspot's `onClick`/`onKeyDown` is correctly wired through React's synthetic event system to the ancestor `advanceOnClick` handler on the outer stage container, this should already PASS once Task 8 and Step 1 above are both in place — this test exists to prove that, not to drive new production code. If it fails, the gap is almost certainly the `onHotspot` prop not actually reaching the rendered `<Stage>` (a threading bug in Step 1), not a `stopPropagation` semantics issue — debug from there first.

- [ ] **Step 4: Fix any threading gap found, re-run**

- [ ] **Step 5: Run full unit suite**

Run: `npm run test`
Expected: PASS

- [ ] **Step 6: Visual verification via the `run` skill**

Present a deck with an authored hotspot (Task 10 provides the authoring UI — sequence this verification after Task 10 if it hasn't landed yet), click it, confirm exactly one camera move happens (the dive), not a dive followed immediately by an advance.

- [ ] **Step 7: Commit**

```bash
git add src/components/present/present-root.tsx src/components/stage/world.tsx <test file>
git commit -m "feat: wire hotspot clicks to session.dive; confirm no double-navigation"
```

---

### Task 10: Editor authoring — hotspot inspector control and "create detail scene here"

**Files:**
- Modify: `src/components/editor/inspector.tsx`
- Modify: `src/lib/data/actions.ts` (a new or extended scene-creation action for "create detail scene here")
- Test: `tests/unit/editor-selectors.test.tsx` or a new inspector-focused test — check existing inspector test coverage first (`grep -rln "inspector" tests/unit/`)

**Interfaces:**
- Consumes: `SceneElement.hotspot` (Task 2), `Scene.flowRole` (Task 1).
- Produces: nothing new consumed elsewhere — this is the leaf authoring surface.

- [ ] **Step 1: Read the current inspector's field-group pattern**

Run: `grep -n "function.*Inspector\|FieldGroup\|Field(" src/components/editor/inspector.tsx | head -30` to find how an existing optional field group (e.g. the element animation controls) is structured, so the new hotspot control matches the file's established pattern exactly rather than introducing a new one.

- [ ] **Step 2: Add the "Expands to detail scene" control**

Add a new field group, following whatever pattern Step 1 found, exposing:
- A toggle or picker to set/clear `element.hotspot`.
- When set: a scene picker listing every scene in the presentation (all `flowRole`s — per the spec, a hotspot may target a main scene too), showing the target's title.
- A "Create detail scene here" button that: calls a new server action (Step 3) creating a scene with `flowRole: "detail"`, sets the current element's `hotspot.targetSceneId` to the new scene's id, and navigates the editor into that new scene — mirroring the existing gap-hover `+` scene-insertion affordance's spirit (check `grep -rn "Add a scene\|insertion.*gap" src/components/editor/` for that existing pattern's exact action name to call analogously, e.g. a `createScene`-style action already exists per the codebase's own established scene-insertion flow — reuse it with `flowRole: "detail"` passed through rather than writing a second scene-creation path).
- An accessible-name input, defaulting to empty, with placeholder text explaining the fallback behavior (e.g. "Leave blank to use the target scene's title").

- [ ] **Step 3: Add or extend the scene-creation server action for `flowRole: "detail"`**

Find the existing scene-creation action (`grep -n "export async function createScene" src/lib/data/actions.ts`) and add an optional `flowRole` parameter (defaulting to `"main"`, so every other call site is unaffected), validated the same way `Scene`'s schema already validates it (Task 1).

- [ ] **Step 4: Write a component test for the inspector control**

Following whatever pattern Step 1's inspector test investigation found, add a test asserting: selecting an element with no `hotspot` shows the "Expands to detail scene" affordance in its unset state; setting a target via the picker updates the element's `hotspot.targetSceneId`; clearing it sets `hotspot` back to `null`.

- [ ] **Step 5: Run the test**

Run whatever command Step 4's test file uses.
Expected: PASS once Steps 2-3 are correctly wired (write the test first if following strict TDD ordering — this task's Step 4 is placed after implementation here only because the inspector's existing patterns needed to be read first in Step 1; reorder to test-first in execution if the two-stage review process this plan is meant to go through prefers that).

- [ ] **Step 6: Visual verification via the `run` skill**

Author a hotspot end-to-end: select an element, use "Create detail scene here," confirm a new scene appears with `flowRole: "detail"` (verify it does NOT appear in the scene-jumper per Task 7, and does not affect the movement rail's count per Task 6), write some content into it, present, click the hotspot, confirm the dive and the return.

- [ ] **Step 7: Commit**

```bash
git add src/components/editor/inspector.tsx src/lib/data/actions.ts <test file>
git commit -m "feat: author hotspots from the inspector, including create-detail-scene-here"
```

---

## Final verification (all tasks)

- [ ] Run `npm run verify` — must exit 0.
- [ ] Run `npm run test:rls` — confirm the new `scenes.flow_role` column doesn't need its own policy (it shouldn't, per Task 1's note) and that existing owner-scoped tests still pass with the new column present.
- [ ] Walk every item in the amended spec's Testing section
  (`docs/superpowers/specs/2026-08-23-hotspot-elements-design.md`) against
  this plan's tasks and confirm each has a corresponding task — this plan's
  tasks were written to cover: schema round-trip (Tasks 1-2), self-target
  rejection (Task 2), dangling-reference repair (Task 3), dive/prev
  precedence and nested dives (Task 5), protocol version/divePath defaulting
  (Task 4), movements/totalScenes exclusion (Task 6), scene-jumper exclusion
  (Task 7), whole-stage click non-interference and keyboard activation
  (Tasks 8-9), and authoring (Task 10).
- [ ] Live walkthrough via the `run` skill covering the full loop: author a
  hotspot, present, dive, retrace with back, confirm the movement rail and
  scene counter never shifted during the detour, confirm a second, nested
  dive also retraces correctly.
