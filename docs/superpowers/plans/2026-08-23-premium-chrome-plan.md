# Premium Chrome & Journey Polish Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the gap between the stage's already-excellent visual craft and the flatter dashboard/templates/editor chrome around it, fix two verified token/theme-default defects, and add two small additive polish touches to the journey/present-mode experience — with measurable acceptance criteria, not subjective claims.

**Architecture:** Pure frontend/CSS/component work. No new routes, no schema changes, no migrations. Touches Tailwind v4 `@theme` tokens in `globals.css`, the theme-preference contract in `theme-provider.tsx` + the pre-hydration bootstrap script in `layout.tsx`, existing dashboard card components, and two present-mode rendering additions in `world.tsx`/`movement-rail.tsx`.

**Tech Stack:** Next.js 16 (Turbopack), React (Compiler on), Tailwind v4, Zustand (present-mode session store), Vitest + Testing Library + jsdom, Playwright (`run` skill for live visual verification).

## Global Constraints

- `npm run verify` (typecheck → lint → unit tests → build) must pass before any task is considered done, per AGENTS.md.
- No new colors, gradients, or a second accent — `docs/DESIGN.md`'s "deliberately avoided" list applies throughout.
- `camera.ts` (flight interpolation) and `arrange.ts` (placement math) are not modified by any task in this plan. `world.tsx`'s culling/LOD _selection_ logic (the `rendered` memo's endpoint-based detail decisions) is not modified — only its rendering-level output (path/glow visuals, the establish-section signpost) in Tasks 7–8.
- Every new CSS transition/animation this plan adds must respect `prefers-reduced-motion` (Tailwind's `motion-reduce:` variant, or an equivalent guard) — this is acceptance criterion 3 in the spec, not optional polish.
- Movement/moment/scene vocabulary only — never "slide" in code comments or UI copy, per AGENTS.md's style rule.

---

### Task 1: Light theme surface tokens read as warm paper, with contrast verified

**Files:**

- Modify: `src/app/globals.css:37-41` (light-mode `--surface-*` tokens)
- Modify: `src/lib/utils/color.ts` (add OKLCH→hex conversion, needed to contrast-check OKLCH tokens against the existing WCAG-based `contrastRatio`)
- Test: `tests/unit/color-oklch.test.ts` (new)
- Test: `tests/unit/theme-contrast.test.ts` (new)

**Interfaces:**

- Consumes: `contrastRatio(a: string, b: string): number` and `relativeLuminance(hex: string): number`, already exported from `src/lib/utils/color.ts:66-78` (hex-based, implements the real WCAG relative-luminance formula — reuse it rather than inventing a second one).
- Produces: `parseOklch(css: string): Oklab` and `oklabToHex(lab: Oklab): string`, new exports from `src/lib/utils/color.ts`, for converting a CSS `oklch(L C H)` string to the hex format `contrastRatio` expects. Later tasks in this plan don't depend on these, but any future token-contrast test should reuse them rather than re-deriving the conversion.

- [ ] **Step 1: Write the failing test for the OKLCH→hex round trip**

```typescript
// tests/unit/color-oklch.test.ts
import { describe, expect, it } from "vitest";
import { parseOklch, oklabToHex, toOklab } from "@/lib/utils/color";

describe("parseOklch", () => {
  it("parses an oklch() CSS string into L/a/b", () => {
    // oklch(0.5 0 0) is achromatic (a = b = 0) — the simplest case to hand-check.
    const lab = parseOklch("oklch(0.5 0 0)");
    expect(lab.L).toBeCloseTo(0.5, 5);
    expect(lab.a).toBeCloseTo(0, 5);
    expect(lab.b).toBeCloseTo(0, 5);
  });

  it("splits chroma into a/b by hue", () => {
    const lab = parseOklch("oklch(0.7 0.1 90)");
    // hue 90deg: a = C*cos(90deg) ~= 0, b = C*sin(90deg) ~= C
    expect(lab.a).toBeCloseTo(0, 2);
    expect(lab.b).toBeCloseTo(0.1, 2);
  });
});

describe("oklabToHex", () => {
  it("round-trips white and black", () => {
    expect(oklabToHex(toOklab("#ffffff")).toLowerCase()).toBe("#ffffff");
    expect(oklabToHex(toOklab("#000000")).toLowerCase()).toBe("#000000");
  });

  it("round-trips an arbitrary colour within one hex step", () => {
    const original = "#3366cc";
    const roundTripped = oklabToHex(toOklab(original));
    // Allow ±2/255 per channel for float rounding through cube roots.
    const a = Number.parseInt(original.slice(1), 16);
    const b = Number.parseInt(roundTripped.replace("#", ""), 16);
    const da = Math.abs(((a >> 16) & 0xff) - ((b >> 16) & 0xff));
    const dg = Math.abs(((a >> 8) & 0xff) - ((b >> 8) & 0xff));
    const db = Math.abs((a & 0xff) - (b & 0xff));
    expect(da).toBeLessThanOrEqual(2);
    expect(dg).toBeLessThanOrEqual(2);
    expect(db).toBeLessThanOrEqual(2);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/color-oklch.test.ts`
Expected: FAIL — `parseOklch`/`oklabToHex` are not exported yet.

- [ ] **Step 3: Implement the OKLCH→hex conversion**

Append to `src/lib/utils/color.ts` (the inverse of the existing `toOklab`'s sRGB→OKLab matrices, both from Björn Ottosson's published OKLab reference — the same source the forward direction already cites):

```typescript
/** Inverse of `linearize`: linear-light channel back to gamma-encoded sRGB. */
function gammaEncode(channel: number): number {
  const clamped = Math.min(1, Math.max(0, channel));
  return clamped <= 0.0031308 ? clamped * 12.92 : 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
}

/** OKLab to sRGB hex. Inverse of `toOklab`. */
export function oklabToHex({ L, a, b }: Oklab): string {
  const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = L - 0.0894841775 * a - 1.291485548 * b;

  const l = l_ ** 3;
  const m = m_ ** 3;
  const s = s_ ** 3;

  const r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
  const g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
  const bl = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;

  const toHex = (c: number) =>
    Math.round(gammaEncode(c) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(bl)}`;
}

const OKLCH = /^oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*\)$/i;

/** Parses a CSS `oklch(L C H)` string (L and C in 0..1/typical range, H in degrees). */
export function parseOklch(css: string): Oklab {
  const match = OKLCH.exec(css.trim());
  if (!match) return { L: 0, a: 0, b: 0 };
  const [, lStr, cStr, hStr] = match;
  const L = Number.parseFloat(lStr);
  const C = Number.parseFloat(cStr);
  const hRad = (Number.parseFloat(hStr) * Math.PI) / 180;
  return { L, a: C * Math.cos(hRad), b: C * Math.sin(hRad) };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/color-oklch.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/lib/utils/color.ts tests/unit/color-oklch.test.ts
git commit -m "feat: OKLCH-to-hex conversion for design-token contrast checks"
```

- [ ] **Step 6: Write the failing contrast test against current tokens**

This asserts the _current_ light-mode tokens already meet the bar (they do — `text-primary` L=0.22 against `surface-base` L=0.985 is a huge lightness delta) and locks in that the upcoming chroma bump must not regress it:

```typescript
// tests/unit/theme-contrast.test.ts
import { describe, expect, it } from "vitest";
import { contrastRatio, oklabToHex, parseOklch } from "@/lib/utils/color";

// Mirrors the light-mode tokens in src/app/globals.css:37-56. Kept as literals
// (not imported from CSS) because Vitest doesn't parse CSS custom properties —
// if these drift from globals.css, this test's comment is the tripwire to
// update both together.
const LIGHT_TOKENS = {
  surfaceBase: "oklch(0.985 0.01 90)", // Task 1 target value, see Step 7
  surfaceSunken: "oklch(0.955 0.015 90)",
  surfaceRaised: "oklch(1 0 0)",
  textPrimary: "oklch(0.22 0.012 265)",
  textSecondary: "oklch(0.44 0.012 265)",
  textMuted: "oklch(0.6 0.012 265)",
};

const hex = (oklch: string) => oklabToHex(parseOklch(oklch));

// WCAG AA for normal text.
const MIN_BODY_CONTRAST = 4.5;

describe("light theme contrast after the warmth bump", () => {
  it("keeps primary text readable on every surface", () => {
    for (const surface of [
      LIGHT_TOKENS.surfaceBase,
      LIGHT_TOKENS.surfaceSunken,
      LIGHT_TOKENS.surfaceRaised,
    ]) {
      expect(contrastRatio(hex(LIGHT_TOKENS.textPrimary), hex(surface))).toBeGreaterThanOrEqual(
        MIN_BODY_CONTRAST,
      );
    }
  });

  it("keeps secondary text readable on the base surface", () => {
    expect(
      contrastRatio(hex(LIGHT_TOKENS.textSecondary), hex(LIGHT_TOKENS.surfaceBase)),
    ).toBeGreaterThanOrEqual(MIN_BODY_CONTRAST);
  });
});
```

- [ ] **Step 7: Run it to see the target values are self-consistent, then apply the real token change**

Run: `npx vitest run tests/unit/theme-contrast.test.ts`
Expected: PASS (this test checks proposed values, not the file yet — it's here to prove the target values are safe before editing `globals.css`).

Edit `src/app/globals.css:37-41`:

```css
--surface-base: oklch(0.985 0.01 90);
--surface-sunken: oklch(0.955 0.015 90);
--surface-raised: oklch(0.99 0.006 90);
--surface-overlay: oklch(0.99 0.006 90);
--surface-inset: oklch(0.965 0.012 90);
```

(Chroma raised roughly 3x on each token — enough to read as paper against a pure-white reference per manual comparison in Step 9, `--surface-raised`/`--surface-overlay` given a whisper of warmth too since they were previously pure white with no warmth at all.)

- [ ] **Step 8: Run full unit suite to confirm nothing else assumed the old values**

Run: `npm run test`
Expected: PASS. If any snapshot or literal-hex test elsewhere depends on the old token values, update it — grep for `0.985 0.003` and `0.955 0.005` first: `grep -rn "0.985 0.003\|0.955 0.005" src/ tests/`.

- [ ] **Step 9: Visual verification via the `run` skill**

Launch the dev server, screenshot the dashboard, templates gallery, and an editor's chrome (not the stage/canvas — that's dark-themed content, untouched) in light mode. Confirm it reads as warm paper next to a pure-white reference, not muddy. This is the subjective checkpoint from the spec's acceptance criteria — a human judgment call, made here with the deterministic contrast floor already guaranteed by Step 6.

- [ ] **Step 10: Commit**

```bash
git add src/app/globals.css tests/unit/theme-contrast.test.ts
git commit -m "fix: light theme surface tokens now read as warm paper, not white"
```

---

### Task 2: First-visit theme defaults to dark; explicit "System" still follows OS

**Files:**

- Modify: `src/components/ui/theme-provider.tsx`
- Modify: `src/app/layout.tsx:60-64` (the pre-hydration bootstrap script — must change in the same commit as the provider; see the spec's Risk note)
- Test: `tests/unit/theme-provider.test.tsx` (new)

**Interfaces:**

- Consumes: nothing new.
- Produces: `readPreference(): "light" | "dark" | "system" | null` (return type changes — `null` now means "nothing stored," distinct from the literal `"system"`, which now only occurs when the user explicitly chose it in Settings). `getSnapshot()`'s resolved value changes: `null` preference resolves `"dark"` unconditionally (no `matchMedia` check); `"system"` preference still checks `matchMedia("(prefers-color-scheme: dark)")`. `useTheme()`'s public `{ pref, resolved, setPref }` shape is unchanged — `pref` is `"system"` in the UI-facing sense whenever nothing explicit is stored, so `settings-panel.tsx`'s existing Light/Dark/System control needs no changes (verify this in Step 6).

- [ ] **Step 1: Write the failing tests for the new default policy**

```typescript
// tests/unit/theme-provider.test.tsx
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/components/ui/theme-provider";

function Harness() {
  const { pref, resolved, setPref } = useTheme();
  return (
    <div>
      <span data-testid="pref">{pref}</span>
      <span data-testid="resolved">{resolved}</span>
      <button onClick={() => setPref("system")}>system</button>
      <button onClick={() => setPref("light")}>light</button>
    </div>
  );
}

function mockMatchMedia(prefersDark: boolean) {
  globalThis.matchMedia = ((query: string) => ({
    matches: query.includes("dark") ? prefersDark : false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })) as unknown as typeof matchMedia;
}

describe("theme default policy", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.removeAttribute("data-theme");
  });
  afterEach(() => {
    localStorage.clear();
  });

  it("resolves dark on first visit even when the OS prefers light", () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("resolves dark on first visit even when the OS prefers dark (same outcome, different reason)", () => {
    mockMatchMedia(true);
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
    expect(screen.getByTestId("resolved").textContent).toBe("dark");
  });

  it("an explicit System preference still follows the OS", () => {
    mockMatchMedia(false);
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
    act(() => screen.getByText("system").click());
    expect(screen.getByTestId("resolved").textContent).toBe("light");

    mockMatchMedia(true);
    act(() => window.dispatchEvent(new Event("storage")));
    // resolved is recomputed from matchMedia on the next snapshot read; the
    // component re-renders because the store's subscribe callback fires on
    // matchMedia's own change event in real browsers. Here we simulate the
    // externally-observed effect via the same "storage" signal the provider
    // already listens to for cross-tab preference sync.
  });

  it("an explicit Light/Dark preference is unaffected", () => {
    mockMatchMedia(true);
    render(
      <ThemeProvider>
        <Harness />
      </ThemeProvider>,
    );
    act(() => screen.getByText("light").click());
    expect(screen.getByTestId("resolved").textContent).toBe("light");
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/theme-provider.test.tsx`
Expected: FAIL on the first two ("resolves dark on first visit") — current code resolves `"light"` when `matchMedia` reports no dark preference, because `readPreference()` returns the literal `"system"` for the unset case and defers to `matchMedia`.

- [ ] **Step 3: Update `readPreference` and `getSnapshot` to distinguish "unset" from "system"**

Edit `src/components/ui/theme-provider.tsx`:

```typescript
type ThemePref = "system" | "light" | "dark";
type StoredPref = ThemePref | null;

function readPreference(): StoredPref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Private browsing or blocked storage; fall through to the default.
  }
  return null;
}

function getSnapshot(): `${ThemePref}:${"light" | "dark"}` {
  const stored = readPreference();
  const pref: ThemePref = stored ?? "system";
  const dark =
    stored === "dark" ||
    // No stored preference at all defaults to dark, regardless of OS
    // preference — the "system" branch (OS-driven) only applies once the
    // user has explicitly chosen "System" in Settings.
    stored === null ||
    (stored === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const resolved = dark ? "dark" : "light";

  const root = document.documentElement;
  if (root.getAttribute("data-theme") !== resolved) root.setAttribute("data-theme", resolved);

  return `${pref}:${resolved}`;
}
```

`getServerSnapshot` stays `() => "system:dark" as const` — already correct for the new policy (dark is now genuinely what an unset/first-visit session resolves to, so the SSR guess matches reality more often, not less).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/theme-provider.test.tsx`
Expected: PASS

- [ ] **Step 5: Update the pre-hydration bootstrap script to match exactly**

Edit `src/app/layout.tsx:62` (must encode the identical policy — a mismatch reintroduces the flash the script exists to prevent):

```typescript
__html: `(function(){try{var s=localStorage.getItem('captivate-theme');var d=s==='dark'||s===null||(s==='system'&&matchMedia('(prefers-color-scheme: dark)').matches);document.documentElement.setAttribute('data-theme',d?'dark':'light');}catch(e){document.documentElement.setAttribute('data-theme','dark');}})();`,
```

(Changed `var s=localStorage.getItem('captivate-theme')||'system';` to `var s=localStorage.getItem('captivate-theme');`, dropping the `||'system'` fallback, and added `s===null` as its own branch of the dark condition — this is the same "unset defaults dark, explicit system follows OS" logic as Step 3, expressed in the pre-hydration script's plain JS.)

- [ ] **Step 6: Verify `settings-panel.tsx`'s Light/Dark/System control needs no change**

Read `src/components/dashboard/settings-panel.tsx` around its `useTheme`/`setPref` usage (found via `grep -n "useTheme\|setPref" src/components/dashboard/settings-panel.tsx`). Confirm it renders from `pref` (which is still exactly `"light" | "dark" | "system"` in the UI-facing sense — `getSnapshot` above maps a `null` stored value to the UI pref `"system"` for the returned tuple) and calls `setPref("system" | "light" | "dark")`. No production code change expected here; this step is verification, not implementation — if the control does need a change, that's a plan gap to fix before continuing, not a silent scope change.

- [ ] **Step 7: Manual verification of the no-flash property**

The unit tests cover the resolved _value_; they don't cover paint timing. Via the `run` skill: clear all site data for `localhost:3000`, load `/home`, and check `console --errors` plus a screenshot taken as early as possible after `nav` — confirm no visible light flash before dark paints. This is what acceptance criterion 1 in the spec actually requires and a jsdom unit test structurally cannot observe.

- [ ] **Step 8: Run full verify gate**

Run: `npm run verify`
Expected: PASS

- [ ] **Step 9: Commit**

```bash
git add src/components/ui/theme-provider.tsx src/app/layout.tsx tests/unit/theme-provider.test.tsx
git commit -m "fix: default to dark on first visit; explicit System still follows OS"
```

---

### Task 3: Card hover/elevation transitions respect `prefers-reduced-motion`

**Files:**

- Modify: `src/components/dashboard/presentation-card.tsx:86-91`
- Modify: `src/components/dashboard/template-gallery.tsx:44-51`
- Test: `tests/unit/card-reduced-motion.test.tsx` (new)

**Interfaces:**

- Consumes: nothing new — Tailwind's built-in `motion-reduce:` variant, which compiles to a `@media (prefers-reduced-motion: reduce)` rule, no JS/React dependency (so `ReducedMotionProvider`, which only reaches `motion/react`, is correctly left untouched).
- Produces: nothing other components depend on.

**Note on findings:** both files already implement the hover/elevation choreography (`hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]`) — confirmed by reading the current source during planning; the original spec draft's "no hover choreography" finding was corrected in the spec before this plan was written. This task is the verified real gap: neither respects `prefers-reduced-motion`.

- [ ] **Step 1: Write the failing test**

```typescript
// tests/unit/card-reduced-motion.test.tsx
import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PresentationCard } from "@/components/dashboard/presentation-card";

const PRESENTATION = {
  id: "00000000-0000-4000-8000-000000000001",
  title: "Test deck",
  sceneCount: 3,
  updatedAt: new Date().toISOString(),
  isFavorite: false,
  themeId: "midnight",
  aspectRatio: "16:9" as const,
  folderName: null,
};

describe("PresentationCard reduced-motion", () => {
  it("guards the hover transform/shadow transition with motion-reduce:", () => {
    const { container } = render(<PresentationCard presentation={PRESENTATION} preview={null} />);
    const card = container.querySelector<HTMLElement>(".group");
    expect(card).not.toBeNull();
    expect(card!.className).toMatch(/motion-reduce:(transition-none|transform-none)/);
  });
});
```

Run `grep -n "aspectRatio\|PresentationSummary" src/lib/data/presentations.ts` first if the fixture above doesn't typecheck — match the real `PresentationSummary` shape exactly rather than guessing extra/missing fields.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/card-reduced-motion.test.tsx`
Expected: FAIL — no `motion-reduce:` class present yet.

- [ ] **Step 3: Add the guard to both components**

Edit `src/components/dashboard/presentation-card.tsx:86-91`, adding `motion-reduce:transition-none motion-reduce:transform-none` to the existing `cn(...)` call (keep every existing class, only add these two):

```typescript
      className={cn(
        "group border-line-subtle bg-raised relative flex flex-col overflow-hidden rounded-[var(--radius-lg)] border",
        "transition-[border-color,box-shadow,transform] duration-[var(--duration-base)]",
        "hover:border-line hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]",
        "motion-reduce:transition-none motion-reduce:transform-none",
        pending && "opacity-70",
      )}
```

Edit `src/components/dashboard/template-gallery.tsx:46-50` the same way:

```typescript
              className={cn(
                "group border-line-subtle bg-raised w-full overflow-hidden rounded-[var(--radius-lg)] border text-left",
                "transition-[border-color,transform,box-shadow] duration-[var(--duration-base)]",
                "hover:border-line hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]",
                "motion-reduce:transition-none motion-reduce:transform-none",
              )}
```

(`motion-reduce:transform-none` neutralizes the `-translate-y-0.5` hover shift specifically; `motion-reduce:transition-none` stops it animating into place even if some other rule still moves it — belt and suspenders, and consistent with how the codebase already treats reduced-motion as non-negotiable elsewhere per `docs/UX.md`.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/card-reduced-motion.test.tsx`
Expected: PASS

- [ ] **Step 5: Visual verification**

Via the `run` skill, with the OS/browser reduced-motion preference forced on (Chromium: `--force-prefers-reduced-motion` launch flag, or Playwright's `page.emulateMedia({ reducedMotion: 'reduce' })`), hover a card on `/home` and `/templates` and confirm no movement/shadow transition, only the instant end state.

- [ ] **Step 6: Commit**

```bash
git add src/components/dashboard/presentation-card.tsx src/components/dashboard/template-gallery.tsx tests/unit/card-reduced-motion.test.tsx
git commit -m "fix: card hover/elevation transitions respect prefers-reduced-motion"
```

---

### Task 4: `asset-library.tsx` card parity and `recordings-library.tsx` row hover state

**Files:**

- Modify: `src/components/dashboard/asset-library.tsx:179` (asset card)
- Modify: `src/components/dashboard/recordings-library.tsx:77-78` (recording row)
- Test: extend `tests/unit/card-reduced-motion.test.tsx` from Task 3

**Interfaces:** none new.

**Findings from reading both files during planning** (not an assumed gap — verified against the actual current markup):

- `asset-library.tsx`'s grid cards (line 179) already have hover choreography
  (`hover:border-line`, `hover:-translate-y-0.5`,
  `transition-[border-color,transform] duration-[var(--duration-fast)]`) but,
  unlike `presentation-card.tsx`/`template-gallery.tsx`, no `hover:shadow-*`
  and no `motion-reduce:` guard.
- `recordings-library.tsx` is a **list of rows**, not a card grid (line
  77-78: `border-line-subtle bg-raised ... rounded-[var(--radius-lg)] border
px-4 py-3.5`) — applying a card-style lift/shadow here would be
  inconsistent with a row's own visual language, not a parity fix. The real
  gap is narrower: the row has no hover state at all today, so nothing
  signals it's interactive on hover.

- [ ] **Step 1: Write the failing test for the asset card's reduced-motion guard and missing shadow**

Extend `tests/unit/card-reduced-motion.test.tsx` (Task 3) with:

```typescript
import { AssetLibrary } from "@/components/dashboard/asset-library";
// ... existing imports from Task 3

describe("AssetLibrary card reduced-motion and shadow parity", () => {
  it("guards its hover transition and includes a hover shadow", () => {
    const { container } = render(
      <AssetLibrary assets={[]} usedBytes={0} quotaBytes={1_000_000_000} />,
    );
    // Confirm the actual required props via:
    // grep -n "export function AssetLibrary" -A 10 src/components/dashboard/asset-library.tsx
    // and adjust this fixture to match exactly before running.
    const cards = container.querySelectorAll<HTMLElement>(".group");
    for (const card of cards) {
      expect(card.className).toMatch(/motion-reduce:(transition-none|transform-none)/);
      expect(card.className).toMatch(/hover:shadow-/);
    }
  });
});
```

(This test needs at least one asset to render a card — if the component requires non-empty `assets` to reach the card branch, pass a minimal fixture matching its real item type; check via `grep -n "interface.*Asset\b" src/components/dashboard/asset-library.tsx` first.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/card-reduced-motion.test.tsx`
Expected: FAIL — no `motion-reduce:` class, no `hover:shadow-` class on the asset card yet.

- [ ] **Step 3: Fix `asset-library.tsx:179`**

```typescript
className =
  "group border-line-subtle bg-raised hover:border-line w-full overflow-hidden rounded-[var(--radius-md)] border text-left transition-[border-color,transform,box-shadow] duration-[var(--duration-fast)] hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] motion-reduce:transition-none motion-reduce:transform-none";
```

(Added `box-shadow` to the transitioned properties, `hover:shadow-[var(--shadow-md)]` to match the other two card types, and the same `motion-reduce:` guard from Task 3.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/card-reduced-motion.test.tsx`
Expected: PASS

- [ ] **Step 5: Add a hover state to `recordings-library.tsx`'s row (no test needed — visual-only, verified in Step 6)**

Edit `src/components/dashboard/recordings-library.tsx:77-78`:

```typescript
              className={cn(
                "border-line-subtle bg-raised hover:border-line flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border px-4 py-3.5",
                "transition-[border-color] duration-[var(--duration-fast)] motion-reduce:transition-none",
```

(Keep every className after this that the existing `cn(...)` call already has — this only adds the hover/transition/reduced-motion classes to the first two string arguments. A border-color-only transition, not a lift, matches a row's visual language rather than importing the card grid's elevation treatment onto a list.)

- [ ] **Step 6: Visual verification**

Via the `run` skill: confirm asset cards now show a shadow on hover matching presentation/template cards, confirm recording rows show a border highlight on hover, and confirm both are inert under forced `prefers-reduced-motion: reduce`.

- [ ] **Step 7: Commit**

```bash
git add src/components/dashboard/asset-library.tsx src/components/dashboard/recordings-library.tsx tests/unit/card-reduced-motion.test.tsx
git commit -m "fix: asset card hover parity (shadow, reduced-motion) and recording row hover state"
```

---

### Task 5: Empty states meet the "three concrete next steps" bar everywhere

**Files:**

- Read: every empty-state render in `presentations-library.tsx`, `asset-library.tsx`, `recordings-library.tsx`, `src/app/(app)/notes/page.tsx` (or wherever the notes empty state lives — confirm via `grep -rn "No .* yet\|empty" src/components/dashboard/ src/app/\(app\)/notes/`)
- Modify (only if a gap is found): the specific file

**Interfaces:** none new.

- [ ] **Step 1: Enumerate every empty state**

Run: `grep -rln "No .*yet\|empty-state\|EmptyState" src/components/dashboard/ src/app/\(app\)/`

- [ ] **Step 2: Check each against `docs/UX.md`'s bar** ("An empty scene offers three concrete next steps... A blank rectangle with 'No items' teaches nothing.")

The audit already confirmed the dashboard's `presentations-library.tsx` empty state does this (icon, heading, description, two concrete actions — "Create with AI" / "Start blank", visible in the live screenshot taken during the design audit). For each other empty state found in Step 1, confirm it likewise offers concrete next steps, not just an icon and a caption.

- [ ] **Step 3: Fix any that fall short**, following `presentations-library.tsx`'s existing structure (icon, heading, one-sentence explanation, 2-3 concrete actions as buttons/links) rather than inventing a new empty-state pattern.

- [ ] **Step 4: Commit** (only if a fix was needed)

```bash
git add <file>
git commit -m "fix: <surface> empty state offers concrete next steps, not just an icon"
```

---

### Task 6: Interactive control sizing meets the 28px minimum

**Files:**

- Read: sidebar (`src/components/dashboard/` shell/nav), card action buttons (`presentation-card.tsx`'s favorite/menu buttons), top bars (`src/components/editor/top-bar.tsx`)
- Modify (only if a violation is found): the specific file

**Interfaces:** none new.

- [ ] **Step 1: Audit interactive control sizing**

`docs/DESIGN.md` sets a 28px minimum for interactive controls. Note from reading `presentation-card.tsx` during planning: the favorite/menu buttons use `size-3`/`size-3.5` _icons_ (12-14px) inside a `p-1` button — Tailwind `p-1` is 4px padding, giving a total hit target around 20-22px, likely under the 28px floor. Verify precisely: `grep -n "p-1\b" src/components/dashboard/presentation-card.tsx` and compute actual rendered size (icon size + padding × 2 + any border).

- [ ] **Step 2: For any control under 28px, increase padding (not icon size)** to reach the floor without changing the visual weight of the icon itself — e.g. `p-1` → `p-1.5` or `p-2` depending on the icon size found in Step 1. Verify the new computed size meets 28px exactly (icon + 2×padding ≥ 28px).

- [ ] **Step 3: Visual verification** via the `run` skill — confirm the larger hit target doesn't visually crowd adjacent elements (favorite star + menu button in `presentation-card.tsx` sit close together).

- [ ] **Step 4: Commit**

```bash
git add <files>
git commit -m "fix: interactive controls meet the 28px minimum hit-target size"
```

---

### Task 7: Establish-section beat gets a signpost, reusing `MovementSignpost`

**Files:**

- Modify: `src/components/present/movement-rail.tsx:154-186` (`MovementSignpost`)
- Modify: `src/components/present/present-root.tsx:58-59, 276-284`
- Test: `tests/unit/movements.test.ts` (extend) or new `tests/unit/movement-signpost.test.tsx`

**Interfaces:**

- Consumes: `session.establishing: string | null` (`src/lib/present/session.ts:69`, already exists — the sectionId being established, set for `ESTABLISH_MS` when a `next`/`prev`/`goto` crosses into a new section, per `maybeEstablish` at `session.ts:271-282`), `Movement` type (`movement-rail.tsx:20-27`, has `id`/`label`/`start`/`end`).
- Produces: `MovementSignpost`'s prop shape grows to accept a `kind: "next" | "entering"` (default `"next"` to keep every existing call site — there's exactly one, in `present-root.tsx:279` — working unchanged unless explicitly updated).

**Design:** `MovementSignpost` already renders a movement's label as a transient overlay; today it's wired only to `journey.signpostNext`'s "upcoming movement" preview. Add a second call site during the establish hold, showing the section just entered rather than the next one — reusing the existing, tested visual language instead of inventing a new overlay.

- [ ] **Step 1: Write the failing test for the new `kind` prop**

```typescript
// tests/unit/movement-signpost.test.tsx
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { MovementSignpost, type Movement } from "@/components/present/movement-rail";

const MOVEMENT: Movement = { id: "m1", label: "The core idea", start: 2, end: 5 };

describe("MovementSignpost kind variants", () => {
  it("defaults to the existing 'next movement' copy", () => {
    render(<MovementSignpost movement={MOVEMENT} index={1} sceneTitle="" />);
    expect(screen.getByText(/Next movement/i)).toBeInTheDocument();
  });

  it("shows entering copy when kind is 'entering'", () => {
    render(<MovementSignpost movement={MOVEMENT} index={1} sceneTitle="" kind="entering" />);
    expect(screen.queryByText(/Next movement/i)).not.toBeInTheDocument();
    expect(screen.getByText(MOVEMENT.label)).toBeInTheDocument();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/movement-signpost.test.tsx`
Expected: FAIL — `kind` prop doesn't exist; second test can't find `"entering"` behavior.

- [ ] **Step 3: Add the `kind` prop to `MovementSignpost`**

Edit `src/components/present/movement-rail.tsx:154-186`:

```typescript
export function MovementSignpost({
  movement,
  index,
  sceneTitle,
  kind = "next",
}: {
  movement: Movement;
  index: number;
  sceneTitle: string;
  kind?: "next" | "entering";
}) {
  const eyebrow =
    kind === "next"
      ? `Next movement · ${String(index + 1).padStart(2, "0")}`
      : `Movement · ${String(index + 1).padStart(2, "0")}`;
  const caption =
    kind === "next" ? "The narrative continues without a break." : "Now, in this movement.";

  return (
    <div
      className="pointer-events-none absolute inset-x-0 bottom-[3.4vh] z-10 text-center"
      aria-hidden
    >
      <p className="text-[10px] font-medium tracking-[0.2em] text-[var(--stage-accent)] uppercase">
        {eyebrow}
      </p>
      <p
        className="mt-1.5 text-[1.4vw] leading-tight font-medium"
        style={{ color: "var(--stage-ink)" }}
      >
        {movement.label}
        {sceneTitle && movement.label !== sceneTitle ? ` — ${sceneTitle}` : ""}
      </p>
      <p
        className="mt-1 text-[0.72vw]"
        style={{ color: "color-mix(in oklab, var(--stage-ink) 42%, transparent)" }}
      >
        {caption}
      </p>
    </div>
  );
}
```

(Read the rest of the current function past line 183 first — `grep -n "" src/components/present/movement-rail.tsx | sed -n '154,190p'` — to confirm there's no closing markup this rewrite would drop; preserve anything after the third `<p>` verbatim.)

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/movement-signpost.test.tsx`
Expected: PASS

- [ ] **Step 5: Wire the establish hold to render it in `present-root.tsx`**

Edit `src/components/present/present-root.tsx`. Near the existing `signpost` computation (line 58-59), add a lookup for the establishing movement:

```typescript
const movements = useMemo(() => movementsOf(scenes, sections), [scenes, sections]);
const signpost = journey.signpostNext ? nextMovement(movements, session.sceneIndex) : null;
const signpostIndex = signpost ? movements.indexOf(signpost) : -1;

const establishingMovement = session.establishing
  ? (movements.find((m) => m.id === session.establishing) ?? null)
  : null;
const establishingIndex = establishingMovement ? movements.indexOf(establishingMovement) : -1;
```

Near the existing `MovementSignpost` render (line 278-284), add the establish variant — mutually exclusive with the "next" signpost since `establishing` and `signpostNext` describe different moments:

```typescript
      {signpost && !session.overview && !session.blanked && !session.establishing && (
        <MovementSignpost
          movement={signpost}
          index={signpostIndex}
          sceneTitle={scenes[signpost.start]?.title ?? ""}
        />
      )}

      {establishingMovement && !session.overview && !session.blanked && (
        <MovementSignpost
          movement={establishingMovement}
          index={establishingIndex}
          sceneTitle=""
          kind="entering"
        />
      )}
```

- [ ] **Step 6: Confirm `Movement.id` matches what `session.establishing` stores**

`maybeEstablish` (`session.ts:271-282`) sets `establishing` from `scenes[after]?.sectionId` — verify `movementsOf` (`movement-rail.tsx`, `grep -n "function movementsOf" -A 20`) derives each `Movement.id` from the same section id, not a synthesized index, so the `find((m) => m.id === session.establishing)` lookup in Step 5 actually matches. If `movementsOf` uses a different id scheme, adjust the lookup to whatever key both sides genuinely share — don't leave a silently-always-null lookup in place.

- [ ] **Step 7: Run the present-mode component tests**

Run: `npx vitest run tests/unit/present-load-boundary.test.tsx tests/unit/movements.test.ts tests/unit/movement-signpost.test.tsx`
Expected: PASS

- [ ] **Step 8: Visual verification**

Via the `run` skill, present a multi-section deck, advance across a section boundary, confirm the signpost appears during the hold with the entering section's label and disappears when the hold ends (`ESTABLISH_MS`, `session.ts` — check the exact constant via `grep -n "ESTABLISH_MS" src/lib/present/session.ts`) and the camera dives to the section's first scene.

- [ ] **Step 9: Commit**

```bash
git add src/components/present/movement-rail.tsx src/components/present/present-root.tsx tests/unit/movement-signpost.test.tsx
git commit -m "feat: name the movement during the establish-section hold"
```

---

### Task 8: Overview route/glow legibility at higher scene density

**Files:**

- Read: `src/components/stage/world.tsx:519-554` (route rendering)
- Modify (only if a problem is found): same file

**Interfaces:** none new — rendering-only, per the Global Constraints boundary (culling/LOD selection logic untouched).

- [ ] **Step 1: Build (or reuse) a higher-scene-count test presentation**

Via the `run` skill: use the "Lecture" or another multi-scene template repeatedly, or the editor's "Add scene" affordance, to reach roughly 15 and roughly 25 scenes across multiple sections in one presentation on the live dev server (same Supabase project used for the original audit).

- [ ] **Step 2: Compare the pulled-back overview at 7 (baseline), ~15, and ~25 scenes**

The route's stroke widths and dash pattern are already expressed as fractions of `stage.width` (`world.tsx:539,548,550` — `stage.width * 0.05`, `stage.width * 0.006`, dash `stage.width * 0.002 / 0.028`), i.e. scene-relative, not viewport-pixel or world-extent relative — this is likely already stable as scene count grows, since the route length grows with the world but the stroke/dash units don't shrink relative to it. Confirm this holds visually rather than assuming; screenshot all three densities.

- [ ] **Step 3a: If legible at all three densities** — no code change. Record the confirmation in this task's notes for the final report; nothing to commit.

- [ ] **Step 3b: If it degrades** (e.g. overlapping dashes at high density, or the wide soft stroke — `opacity={0.06}`, `world.tsx:542` — visually merging adjacent path segments) — adjust the fraction constants at `world.tsx:539/542/548/550` (e.g. reduce the dash-gap fraction, or scale stroke width by an inverse function of scene count) and re-screenshot to confirm the fix, then:

```bash
git add src/components/stage/world.tsx
git commit -m "fix: overview route stays legible at higher scene counts"
```

---

## Final verification (all tasks)

- [ ] Run `npm run verify` — must exit 0.
- [ ] Run the full acceptance criteria list from `docs/superpowers/specs/2026-08-23-premium-chrome-design.md`'s "Acceptance criteria" section against the finished branch, deterministic items via their tests (Tasks 1-3, 7), subjective items via one more `run`-skill pass across dashboard, templates, editor chrome, and a live present-mode walkthrough including an establish-section crossing.
- [ ] Confirm no diff touches `src/lib/present/camera.ts`, `src/lib/present/arrange.ts`, or `world.tsx`'s culling/LOD selection logic (the `rendered` memo's detail-level decisions) — `git diff main... -- src/lib/present/camera.ts src/lib/present/arrange.ts` should be empty; `git diff main... -- src/components/stage/world.tsx` should only touch the route-rendering block from Task 8, if that task made any change at all.
