# AI Visual Sourcing Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a presenter search Pexels stock photos or generate an image via OpenAI's `gpt-image-2` for an empty image placeholder, with the generation path gated by an atomically-enforced $100/month budget and a 25/user/day cap, structured per-asset provenance, and allowlisted-host-only server-side ingestion — never a hotlink, never an automatic spend.

**Architecture:** A narrow `StockProvider`/`GenerationProvider` server-side interface (`src/lib/ai/visuals-sourcing.ts`) with exactly one implementation each (Pexels, OpenAI); a new Postgres budget-reservation function guarding `generateImage` before any provider call; structured provenance columns on `assets` (new migration); an editor picker UI extending the existing image-placeholder flow with Search/Generate tabs; server-side fetch-verify-strip-upload for any chosen result, reusing the existing private-storage asset pipeline.

**Tech Stack:** Next.js Server Actions, Zod, Supabase Postgres (new migration + a `SECURITY DEFINER` function for atomic budget reservation, matching the codebase's existing pinned-`search_path` convention), Vitest + Testing Library, `npm run test:rls` for policy tests.

## Global Constraints

- `npm run verify` and `npm run test:rls` must pass before any task is considered done, per AGENTS.md.
- One medium-quality 16:9 image per explicit request. No high-quality tier, no batches, in MVP.
- No provider or model selection exposed to the presenter.
- No general-purpose server-side URL fetcher — ingestion is allowlisted to Pexels' and OpenAI's own response hosts, enumerated exactly (not pattern-matched) at implementation time.
- The budget reservation must fail **closed** on error (deny the call) — this is the opposite posture from `src/lib/ai/rate-limit.ts`'s existing "fail open on infra hiccup" rule, which is correct for its own low-stakes case (an inconvenient block) and wrong for this one (an uncapped-spend incident). Note this divergence explicitly in the code, not just here.
- Every new server action returns `{ ok: true; data } | { ok: false; error }` per AGENTS.md's "errors are values" rule — never throws across that boundary.
- Migrations are append-only; check the actual current highest-numbered file in `supabase/migrations/` at implementation time rather than trusting a number hardcoded in this plan — other work may have landed migrations in between.

---

### Task 1: Structured provenance columns on `assets`

**Files:**
- Create: `supabase/migrations/00NN_asset_provenance.sql` (`NN` = next free number at implementation time; this plan writes `0009` as a placeholder value below, matching where PR #7's plan left off, but confirm before creating the file — if PR #7 has already merged, this really is `0010`; if not, coordinate the actual number with whichever lands first)
- Modify: `src/lib/data/assets.ts` (`RegisterInput`, `registerAsset`)
- Test: `tests/unit/asset-provenance.test.ts` (new) + RLS test

**Interfaces:**
- Produces: `assets.source: "upload" | "stock" | "generated"`, plus the stock-only and generated-only columns below — consumed by Task 5 (asset library display) and Task 3 (the ingestion pipeline that writes them).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0009_asset_provenance.sql
-- Structured provenance for where an asset actually came from.
--
-- A single free-text "attribution" string is enough to display a credit
-- line but not enough to answer a licensing or cost question later. `source`
-- distinguishes a direct upload from a Pexels stock photo from an
-- OpenAI-generated image; the columns after it are populated only for the
-- source they apply to, per the check constraints below.

alter table public.assets
  add column if not exists source text not null default 'upload';

alter table public.assets
  drop constraint if exists assets_source_check;
alter table public.assets
  add constraint assets_source_check
  check (source in ('upload', 'stock', 'generated'));

-- Stock (Pexels) provenance.
alter table public.assets add column if not exists provider_asset_id text;
alter table public.assets add column if not exists original_page_url text;
alter table public.assets add column if not exists creator_name text;
alter table public.assets add column if not exists creator_page_url text;
alter table public.assets add column if not exists license_ref text;
alter table public.assets add column if not exists license_verified_at timestamptz;

-- Generated (OpenAI) provenance.
alter table public.assets add column if not exists generation_provider text;
alter table public.assets add column if not exists generation_model text;
alter table public.assets add column if not exists generation_prompt text;
alter table public.assets add column if not exists generation_quality text;
alter table public.assets add column if not exists generation_ms integer;
alter table public.assets add column if not exists generation_cost_usd numeric(10, 4);

comment on column public.assets.source is
  'upload = direct browser upload; stock = sourced via Pexels; generated = via OpenAI Image API.';
comment on column public.assets.license_verified_at is
  'When this asset''s Pexels licensing was last confirmed against current terms — a terms change has something to check existing rows against.';
```

No RLS policy change — new columns on the already owner-scoped `assets` table.

- [ ] **Step 2: Apply the migration and regenerate types**

Run whatever local-dev flow `docs/DATABASE.md` documents (e.g. `supabase migration up`), then regenerate TypeScript types if the project has a `db:types`-style script (`grep -n "types" package.json`).

- [ ] **Step 3: Write the failing test for `registerAsset` accepting provenance**

```typescript
// tests/unit/asset-provenance.test.ts
import { describe, expect, it, vi } from "vitest";
// Follow this codebase's existing pattern for testing a "use server" action
// against a mocked Supabase client — check tests/unit for an existing
// example (grep -rln "supabaseServer" tests/unit/) and mirror its mocking
// approach exactly rather than inventing a new one.
```

(This step's exact shape depends entirely on how this codebase already tests server actions that touch Supabase — read that pattern first via the grep above before writing a single line, since guessing here risks a test that doesn't actually exercise the real code path.)

- [ ] **Step 4: Extend `RegisterInput` and `registerAsset`'s insert**

Edit `src/lib/data/assets.ts:26-41` (`RegisterInput`), adding optional provenance fields:

```typescript
const RegisterInput = z.object({
  storagePath: z.string().min(1).max(400),
  mimeType: z.string().min(1).max(160),
  byteSize: z.number().int().min(1).max(MAX_UPLOAD_BYTES),
  originalFilename: z.string().max(260).default(""),
  presentationId: z.string().uuid().nullable().optional(),
  width: z.number().int().positive().max(20000).nullable().optional(),
  height: z.number().int().positive().max(20000).nullable().optional(),
  durationSeconds: z
    .number()
    .nonnegative()
    .max(60 * 60 * 12)
    .nullable()
    .optional(),
  altText: z.string().max(600).default(""),
  source: z.enum(["upload", "stock", "generated"]).default("upload"),
  provenance: z
    .discriminatedUnion("source", [
      z.object({ source: z.literal("upload") }),
      z.object({
        source: z.literal("stock"),
        providerAssetId: z.string().max(120),
        originalPageUrl: z.string().url(),
        creatorName: z.string().max(200),
        creatorPageUrl: z.string().url(),
        licenseRef: z.string().max(120),
      }),
      z.object({
        source: z.literal("generated"),
        provider: z.string().max(60),
        model: z.string().max(60),
        prompt: z.string().max(4000),
        quality: z.string().max(40),
        generationMs: z.number().int().nonnegative(),
        costUsd: z.number().nonnegative(),
      }),
    ])
    .optional(),
});
```

Edit the insert (`assets.ts:68-83`) to write the provenance columns when present:

```typescript
  const provenance = parsed.data.provenance;
  const { data, error } = await supabase
    .from("assets")
    .insert({
      storage_path: parsed.data.storagePath,
      mime_type: parsed.data.mimeType,
      byte_size: parsed.data.byteSize,
      kind,
      original_filename: parsed.data.originalFilename,
      presentation_id: parsed.data.presentationId ?? null,
      width: parsed.data.width ?? null,
      height: parsed.data.height ?? null,
      duration_seconds: parsed.data.durationSeconds ?? null,
      alt_text: parsed.data.altText,
      source: parsed.data.source,
      ...(provenance?.source === "stock"
        ? {
            provider_asset_id: provenance.providerAssetId,
            original_page_url: provenance.originalPageUrl,
            creator_name: provenance.creatorName,
            creator_page_url: provenance.creatorPageUrl,
            license_ref: provenance.licenseRef,
            license_verified_at: new Date().toISOString(),
          }
        : {}),
      ...(provenance?.source === "generated"
        ? {
            generation_provider: provenance.provider,
            generation_model: provenance.model,
            generation_prompt: provenance.prompt,
            generation_quality: provenance.quality,
            generation_ms: provenance.generationMs,
            generation_cost_usd: provenance.costUsd,
          }
        : {}),
    })
    .select("id")
    .single();
```

- [ ] **Step 5: Run the test to verify it passes**

Run whatever command Step 3's test file uses.
Expected: PASS

- [ ] **Step 6: Run `npm run test:rls`**

Expected: PASS — confirms the new columns don't break any existing owner-scoped policy test.

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/0009_asset_provenance.sql src/lib/data/assets.ts tests/unit/asset-provenance.test.ts
git commit -m "feat: structured provenance columns on assets (source, stock/generated fields)"
```

---

### Task 2: Atomic budget reservation — schema and Postgres function

**Files:**
- Create: `supabase/migrations/00NN_ai_image_budget.sql` (next free number after Task 1's)
- Test: `tests/unit/image-budget-rls.test.ts` or extend `supabase/tests/` per whatever `npm run test:rls` actually runs (`cat package.json | grep test:rls`, then read `supabase/tests/run.sh`)

**Interfaces:**
- Produces: a Postgres function `reserve_image_generation(p_owner_id uuid, p_estimated_cost_usd numeric, p_today date, p_month text) returns boolean` — atomically checks and reserves against both the $100/month global cap and the 25/user/day cap in one transaction, returning `true` if the reservation succeeded (and has already applied) or `false` if either cap would be exceeded (nothing applied). A companion `reconcile_image_generation(p_owner_id uuid, p_month text, p_estimated_cost_usd numeric, p_actual_cost_usd numeric) returns void` adjusts the monthly total from the estimate to the actual cost after the provider call completes.

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0010_ai_image_budget.sql
-- Atomic budget enforcement for AI image generation.
--
-- $100/month global cap, 25 generations/user/day. Both are enforced by a
-- guarded UPDATE (increment only if the result would stay within the cap),
-- which Postgres serializes per-row — two concurrent requests cannot both
-- read "under the cap" and both proceed, the way a naive
-- read-then-check-then-write in application code could.
--
-- Reservation happens on the *estimate* before the provider call; the actual
-- reported cost reconciles the monthly total after. The daily per-user count
-- is exact at reservation time (it counts generations attempted, not
-- dollars, so there is nothing to reconcile).

create table if not exists public.ai_image_budget_month (
  month           text primary key, -- 'YYYY-MM'
  spent_usd       numeric(10, 4) not null default 0 check (spent_usd >= 0),
  updated_at      timestamptz not null default now()
);

create table if not exists public.ai_image_usage_daily (
  owner_id        uuid not null references auth.users(id) on delete cascade,
  day             date not null,
  generations     integer not null default 0 check (generations >= 0),
  primary key (owner_id, day)
);

alter table public.ai_image_budget_month enable row level security;
alter table public.ai_image_usage_daily enable row level security;

-- Neither table is queried directly by client code — only through the
-- SECURITY DEFINER functions below — so no row is selectable/writable
-- directly by any role. This is deliberately more locked-down than the
-- rest of the schema's owner-scoped pattern, since these rows aren't
-- per-owner data the owner should browse; they're a shared budget ledger.

create or replace function public.reserve_image_generation(
  p_owner_id uuid,
  p_estimated_cost_usd numeric,
  p_today date,
  p_month text
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_month_ok boolean;
  v_day_ok boolean;
begin
  insert into public.ai_image_budget_month (month, spent_usd)
    values (p_month, 0)
    on conflict (month) do nothing;

  insert into public.ai_image_usage_daily (owner_id, day, generations)
    values (p_owner_id, p_today, 0)
    on conflict (owner_id, day) do nothing;

  update public.ai_image_budget_month
    set spent_usd = spent_usd + p_estimated_cost_usd, updated_at = now()
    where month = p_month
      and spent_usd + p_estimated_cost_usd <= 100.00
  returning true into v_month_ok;

  if v_month_ok is not true then
    return false;
  end if;

  update public.ai_image_usage_daily
    set generations = generations + 1
    where owner_id = p_owner_id
      and day = p_today
      and generations < 25
  returning true into v_day_ok;

  if v_day_ok is not true then
    -- Refund the monthly reservation — the day cap is what actually blocked
    -- this request, so the money was never really going to be spent.
    update public.ai_image_budget_month
      set spent_usd = spent_usd - p_estimated_cost_usd, updated_at = now()
      where month = p_month;
    return false;
  end if;

  return true;
end;
$$;

create or replace function public.reconcile_image_generation(
  p_month text,
  p_estimated_cost_usd numeric,
  p_actual_cost_usd numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_image_budget_month
    set spent_usd = greatest(0, spent_usd - p_estimated_cost_usd + p_actual_cost_usd),
        updated_at = now()
    where month = p_month;
end;
$$;

-- If the provider call fails outright (no image produced), the reservation
-- must be released in full rather than reconciled to a nonzero actual cost.
create or replace function public.release_image_generation_reservation(
  p_month text,
  p_estimated_cost_usd numeric
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.ai_image_budget_month
    set spent_usd = greatest(0, spent_usd - p_estimated_cost_usd),
        updated_at = now()
    where month = p_month;
end;
$$;
```

`search_path = public` pinned per AGENTS.md's database rule for `SECURITY DEFINER` functions.

- [ ] **Step 2: Apply the migration locally**

Run the project's documented local-dev migration flow.

- [ ] **Step 3: Write the RLS/function test — concurrent reservation cannot exceed the cap**

Follow `npm run test:rls`'s existing test structure (`ls supabase/tests/`, read one existing test file for the harness pattern — likely raw SQL assertions or a pgTAP-style suite; match it exactly). The test must exercise real concurrency, not just sequential calls, to actually prove the atomicity claim:

```sql
-- Sketch — adapt exactly to this project's real RLS test harness/language.
-- Seed month at $99.00 spent. Two concurrent reserve calls for $2.00 each
-- (both would push total to $103, over the $100 cap) must result in exactly
-- one succeeding and one failing — never both succeeding, never both failing
-- when one alone would fit (verify with $99.00 + one $0.50 request: that one
-- must succeed).
select public.reserve_image_generation('<test-user-uuid>', 2.00, current_date, to_char(current_date, 'YYYY-MM'));
-- Run this and a second call concurrently (via two connections/transactions
-- in whatever the test harness supports for concurrency, e.g. two separate
-- psql sessions in a shell-scripted RLS test, or pg's advisory-lock-free
-- concurrent connections) and assert exactly one returns true.
```

Also test the daily cap boundary directly (25th succeeds, 26th fails, and the 26th's failure does not also further decrement the monthly reservation beyond the one refund) and the refund path (a day-capped reservation leaves `spent_usd` unchanged from before the call, not decremented by more than what was added).

- [ ] **Step 4: Run `npm run test:rls`**

Expected: the new tests PASS, confirming atomicity under real concurrency, not just sequential logic.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/0010_ai_image_budget.sql supabase/tests/<new test file>
git commit -m "feat: atomic budget reservation for AI image generation (Postgres function)"
```

---

### Task 3: Provider interface — `StockProvider` (Pexels) and `GenerationProvider` (OpenAI)

**Files:**
- Create: `src/lib/ai/visuals-sourcing.ts`
- Test: `tests/unit/visuals-sourcing.test.ts` (new)

**Interfaces:**
- Produces: `searchStockPhotos(query: string)`, `generateImage(prompt: string, presentationId: string)` — both exported async server actions returning `{ ok: true; data } | { ok: false; error }`. `isPexelsConfigured()` / `isImageGenerationConfigured()` boolean checks, mirroring `src/lib/ai/provider.ts`'s `isAiConfigured()` pattern exactly.
- Consumes: `reserve_image_generation`/`reconcile_image_generation`/`release_image_generation_reservation` (Task 2), `src/lib/ai/rate-limit.ts`'s `checkRateLimit` (basic call-rate bounding, distinct from the budget gate).

- [ ] **Step 1: Write the failing "not configured" tests**

```typescript
// tests/unit/visuals-sourcing.test.ts
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

describe("visuals sourcing — not configured", () => {
  const originalPexels = process.env.PEXELS_API_KEY;
  const originalOpenAi = process.env.OPENAI_API_KEY;

  afterEach(() => {
    if (originalPexels === undefined) delete process.env.PEXELS_API_KEY;
    else process.env.PEXELS_API_KEY = originalPexels;
    if (originalOpenAi === undefined) delete process.env.OPENAI_API_KEY;
    else process.env.OPENAI_API_KEY = originalOpenAi;
  });

  it("searchStockPhotos returns a clear not-configured error with no key", async () => {
    delete process.env.PEXELS_API_KEY;
    const { searchStockPhotos } = await import("@/lib/ai/visuals-sourcing");
    const result = await searchStockPhotos("mountains");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not configured|PEXELS_API_KEY/i);
  });

  it("generateImage returns a clear not-configured error with no key", async () => {
    delete process.env.OPENAI_API_KEY;
    const { generateImage } = await import("@/lib/ai/visuals-sourcing");
    const result = await generateImage("a mountain landscape", "00000000-0000-4000-8000-000000000001");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toMatch(/not configured|OPENAI_API_KEY/i);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/visuals-sourcing.test.ts`
Expected: FAIL — module doesn't exist yet.

- [ ] **Step 3: Implement the module**

```typescript
// src/lib/ai/visuals-sourcing.ts
import "server-only";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase/server";
import { checkRateLimit, LIMITS } from "@/lib/ai/rate-limit";

/**
 * Image sourcing: exactly one stock provider (Pexels) and one generation
 * provider (OpenAI's gpt-image-2) for MVP, behind narrow interfaces so a
 * future provider swap replaces one implementation rather than rewriting
 * every caller. No provider or model choice is exposed to the presenter.
 */

export interface StockSearchResult {
  thumbnailUrl: string;
  fullUrl: string;
  providerAssetId: string;
  originalPageUrl: string;
  creatorName: string;
  creatorPageUrl: string;
  licenseRef: string;
}

export interface GeneratedImageResult {
  previewUrl: string;
  model: string;
  prompt: string;
  widthPx: number;
  heightPx: number;
  quality: "medium";
  generationMs: number;
  costUsd: number;
}

export function isPexelsConfigured(): boolean {
  return Boolean(process.env.PEXELS_API_KEY);
}

export function isImageGenerationConfigured(): boolean {
  return Boolean(process.env.OPENAI_API_KEY);
}

/** The exact CDN hostnames these two providers return image URLs from. Confirm against real API responses before deploying — do not widen to a pattern. */
const ALLOWED_INGEST_HOSTS = new Set([
  "images.pexels.com",
  // OpenAI's image result host(s) — confirm exact value(s) from a real
  // gpt-image-2 response at implementation time and list them explicitly.
]);

export async function searchStockPhotos(
  query: string,
): Promise<{ ok: true; data: StockSearchResult[] } | { ok: false; error: string }> {
  if (!isPexelsConfigured()) {
    return {
      ok: false,
      error: "Image search isn't configured on this deployment. Set PEXELS_API_KEY to enable it.",
    };
  }

  const parsed = z.string().min(1).max(200).safeParse(query);
  if (!parsed.success) return { ok: false, error: "Enter a search term." };

  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(parsed.data)}&per_page=20`,
      { headers: { Authorization: process.env.PEXELS_API_KEY! } },
    );
    if (!res.ok) return { ok: false, error: "Image search failed. Try again." };
    const body = (await res.json()) as {
      photos: {
        id: number;
        src: { medium: string; large2x: string };
        url: string;
        photographer: string;
        photographer_url: string;
      }[];
    };
    return {
      ok: true,
      data: body.photos.map((p) => ({
        thumbnailUrl: p.src.medium,
        fullUrl: p.src.large2x,
        providerAssetId: String(p.id),
        originalPageUrl: p.url,
        creatorName: p.photographer,
        creatorPageUrl: p.photographer_url,
        licenseRef: "Pexels License",
      })),
    };
  } catch {
    return { ok: false, error: "Image search failed. Try again." };
  }
}

/** Confirm this against OpenAI's current gpt-image-2 pricing at implementation time — do not trust this figure blindly. */
const ESTIMATED_COST_PER_IMAGE_USD = 0.04;

export async function generateImage(
  prompt: string,
  presentationId: string,
): Promise<{ ok: true; data: GeneratedImageResult } | { ok: false; error: string }> {
  if (!isImageGenerationConfigured()) {
    return {
      ok: false,
      error: "Image generation isn't configured on this deployment. Set OPENAI_API_KEY to enable it.",
    };
  }

  const parsed = z.string().min(1).max(2000).safeParse(prompt);
  if (!parsed.success) return { ok: false, error: "Enter a description for the image." };

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };

  const rate = await checkRateLimit(LIMITS.heavy, ["image_generation"]);
  if (!rate.allowed) return { ok: false, error: rate.message };

  const today = new Date().toISOString().slice(0, 10);
  const month = today.slice(0, 7);

  // Budget reservation fails CLOSED — unlike checkRateLimit's fail-open
  // posture, an error here must deny the call, not allow an unbounded spend
  // through on an infrastructure hiccup.
  const { data: reserved, error: reserveError } = await supabase.rpc("reserve_image_generation", {
    p_owner_id: user.id,
    p_estimated_cost_usd: ESTIMATED_COST_PER_IMAGE_USD,
    p_today: today,
    p_month: month,
  });
  if (reserveError) {
    return { ok: false, error: "Couldn't check the generation budget. Try again shortly." };
  }
  if (!reserved) {
    return {
      ok: false,
      error:
        "The monthly image-generation budget or your daily limit has been reached. Search or upload still work.",
    };
  }

  const startedAt = Date.now();
  try {
    const res = await fetch("https://api.openai.com/v1/images/generations", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gpt-image-2",
        prompt: parsed.data,
        n: 1,
        quality: "medium",
        // Confirm OpenAI's exact size/aspect parameter for a 16:9 image at
        // implementation time — do not guess a pixel value here.
        size: "1536x1024", // PLACEHOLDER — verify against current API docs
      }),
    });

    if (!res.ok) {
      await supabase.rpc("release_image_generation_reservation", {
        p_month: month,
        p_estimated_cost_usd: ESTIMATED_COST_PER_IMAGE_USD,
      });
      return { ok: false, error: "Image generation failed. Try again." };
    }

    const body = (await res.json()) as { data: { url: string }[] };
    const generationMs = Date.now() - startedAt;
    const actualCostUsd = ESTIMATED_COST_PER_IMAGE_USD; // Refine once OpenAI's response cost/usage shape is confirmed.

    await supabase.rpc("reconcile_image_generation", {
      p_month: month,
      p_estimated_cost_usd: ESTIMATED_COST_PER_IMAGE_USD,
      p_actual_cost_usd: actualCostUsd,
    });

    return {
      ok: true,
      data: {
        previewUrl: body.data[0].url,
        model: "gpt-image-2",
        prompt: parsed.data,
        widthPx: 1536,
        heightPx: 1024,
        quality: "medium",
        generationMs,
        costUsd: actualCostUsd,
      },
    };
  } catch {
    await supabase.rpc("release_image_generation_reservation", {
      p_month: month,
      p_estimated_cost_usd: ESTIMATED_COST_PER_IMAGE_USD,
    });
    return { ok: false, error: "Image generation failed. Try again." };
  }
}

export function isAllowedIngestHost(hostname: string): boolean {
  return ALLOWED_INGEST_HOSTS.has(hostname);
}
```

(The `presentationId` parameter is accepted but not yet used in this task — it exists so Task 4's `ai_generations`-style audit logging, if wired here rather than at the call site, has it available; confirm during implementation whether this function or its caller is the right place to log the attempt per Task 6's metrics requirement, and remove the unused parameter if the caller ends up owning that instead.)

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/visuals-sourcing.test.ts`
Expected: PASS

- [ ] **Step 5: Write and run a test for the ingestion host allowlist**

```typescript
describe("isAllowedIngestHost", () => {
  it("allows Pexels' image CDN", () => {
    expect(isAllowedIngestHost("images.pexels.com")).toBe(true);
  });
  it("rejects an arbitrary host", () => {
    expect(isAllowedIngestHost("evil.example.com")).toBe(false);
  });
});
```

Run: `npx vitest run tests/unit/visuals-sourcing.test.ts`
Expected: PASS

- [ ] **Step 6: Run full unit suite**

Run: `npm run test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/ai/visuals-sourcing.ts tests/unit/visuals-sourcing.test.ts
git commit -m "feat: Pexels search and OpenAI gpt-image-2 generation behind a narrow provider interface, budget-gated"
```

---

### Task 4: Server-side ingestion — fetch, verify, strip, upload

**Files:**
- Modify: `src/lib/data/assets.ts` (new `registerSourcedAsset` function)
- Test: `tests/unit/asset-ingestion.test.ts` (new)

**Interfaces:**
- Consumes: `isAllowedIngestHost` (Task 3), `MAX_UPLOAD_BYTES`/`ALLOWED_MIME` (`upload-limits.ts`, existing).
- Produces: `registerSourcedAsset(input)`, called by the picker's "Use this image"/"Accept" actions (Task 5).

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/asset-ingestion.test.ts
import { describe, expect, it } from "vitest";
import { registerSourcedAsset } from "@/lib/data/assets";

describe("registerSourcedAsset", () => {
  it("rejects a URL whose host is not on the ingestion allowlist", async () => {
    const result = await registerSourcedAsset({
      url: "https://evil.example.com/image.jpg",
      source: "stock",
      presentationId: "00000000-0000-4000-8000-000000000001",
      provenance: {
        source: "stock",
        providerAssetId: "1",
        originalPageUrl: "https://pexels.com/photo/1",
        creatorName: "Someone",
        creatorPageUrl: "https://pexels.com/@someone",
        licenseRef: "Pexels License",
      },
    });
    expect(result.ok).toBe(false);
  });
});
```

(This first test needs no network mocking — the host check happens before any fetch. Additional tests for the oversized-response and MIME-mismatch cases need a mocked `fetch`; follow this codebase's existing `fetch`-mocking convention if one exists in `tests/unit/` — `grep -rn "vi.stubGlobal.*fetch\|global.fetch =" tests/unit/` — before introducing a new one.)

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/asset-ingestion.test.ts`
Expected: FAIL — `registerSourcedAsset` doesn't exist yet.

- [ ] **Step 3: Implement `registerSourcedAsset`**

Add to `src/lib/data/assets.ts`:

```typescript
import { isAllowedIngestHost } from "@/lib/ai/visuals-sourcing";

const SourcedAssetInput = z.object({
  url: z.string().url(),
  source: z.enum(["stock", "generated"]),
  presentationId: z.string().uuid().nullable().optional(),
  altText: z.string().max(600).default(""),
  provenance: RegisterInput.shape.provenance, // reuse the discriminated union from Task 1
});

export async function registerSourcedAsset(
  input: unknown,
): Promise<AssetResult<{ id: string; url: string }>> {
  const parsed = SourcedAssetInput.safeParse(input);
  if (!parsed.success) return { ok: false, error: "That image couldn't be saved." };

  const target = new URL(parsed.data.url);
  if (!isAllowedIngestHost(target.hostname)) {
    return { ok: false, error: "That image source isn't recognized." };
  }

  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "You're signed out." };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  let bytes: ArrayBuffer;
  let mimeType: string;
  try {
    const res = await fetch(target, { signal: controller.signal });
    if (!res.ok) return { ok: false, error: "Couldn't fetch that image." };

    mimeType = res.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (!ALLOWED_MIME.has(mimeType)) return { ok: false, error: "Unsupported image type." };

    const contentLength = Number(res.headers.get("content-length") ?? "0");
    if (contentLength > MAX_UPLOAD_BYTES) return { ok: false, error: "That image is too large." };

    bytes = await res.arrayBuffer();
    if (bytes.byteLength > MAX_UPLOAD_BYTES) return { ok: false, error: "That image is too large." };
  } catch {
    return { ok: false, error: "Couldn't fetch that image." };
  } finally {
    clearTimeout(timeout);
  }

  // Verify the decoded format actually matches the declared MIME type, and
  // strip metadata (EXIF etc.) before storage — use whatever image-processing
  // library the codebase already depends on for this (check package.json;
  // if none exists yet, this is a new dependency to add, chosen for
  // being able to both verify format and re-encode without metadata, e.g.
  // sharp on a Node runtime — confirm this server action's runtime supports
  // native deps before committing to one).
  // const { width, height, strippedBytes } = await verifyAndStrip(bytes, mimeType);

  const storagePath = `${user.id}/${crypto.randomUUID()}`;
  const { error: uploadError } = await supabase.storage
    .from(STORAGE_BUCKETS.assets)
    .upload(storagePath, bytes /* strippedBytes once verifyAndStrip lands */, { contentType: mimeType });
  if (uploadError) return { ok: false, error: "Couldn't save that image." };

  const { data, error } = await supabase
    .from("assets")
    .insert({
      storage_path: storagePath,
      mime_type: mimeType,
      byte_size: bytes.byteLength,
      kind: "image",
      original_filename: "",
      presentation_id: parsed.data.presentationId ?? null,
      alt_text: parsed.data.altText,
      source: parsed.data.source,
      ...(parsed.data.provenance?.source === "stock"
        ? {
            provider_asset_id: parsed.data.provenance.providerAssetId,
            original_page_url: parsed.data.provenance.originalPageUrl,
            creator_name: parsed.data.provenance.creatorName,
            creator_page_url: parsed.data.provenance.creatorPageUrl,
            license_ref: parsed.data.provenance.licenseRef,
            license_verified_at: new Date().toISOString(),
          }
        : {}),
      ...(parsed.data.provenance?.source === "generated"
        ? {
            generation_provider: parsed.data.provenance.provider,
            generation_model: parsed.data.provenance.model,
            generation_prompt: parsed.data.provenance.prompt,
            generation_quality: parsed.data.provenance.quality,
            generation_ms: parsed.data.provenance.generationMs,
            generation_cost_usd: parsed.data.provenance.costUsd,
          }
        : {}),
    })
    .select("id")
    .single();

  if (error || !data) {
    await supabase.storage.from(STORAGE_BUCKETS.assets).remove([storagePath]);
    return { ok: false, error: error?.message ?? "Could not save the image." };
  }

  revalidatePath("/assets");
  return { ok: true, data: { id: data.id, url: assetUrl(data.id) } };
}
```

Flag the `verifyAndStrip` placeholder explicitly during implementation — this plan does not pick an image-processing library, since that's a real dependency decision (native binary deps like `sharp` may not run in every deployment target) that deserves its own confirmation rather than a default buried in a code sample.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/asset-ingestion.test.ts`
Expected: PASS

- [ ] **Step 5: Add the timeout/oversized/MIME-mismatch tests with a mocked fetch**

Following whatever mocking convention Step 1 found (or establishing one, documented in a comment, if none exists), add:
- A response whose `content-length` header exceeds `MAX_UPLOAD_BYTES` is rejected without reading the body.
- A response with `content-type: text/html` (or any type outside `ALLOWED_MIME`) is rejected.
- A fetch that never resolves is aborted at the timeout, not left hanging.

- [ ] **Step 6: Run full unit suite**

Run: `npm run test`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/lib/data/assets.ts tests/unit/asset-ingestion.test.ts
git commit -m "feat: allowlisted server-side ingestion for stock/generated images"
```

---

### Task 5: Editor picker — Search and Generate tabs

**Files:**
- Modify: whichever component currently opens on an empty image placeholder click (identify exact file via `grep -rn "empty.*image\|ImagePlaceholder\|onClick.*image" src/components/editor/` — the original spec flagged this as "verify exact component during implementation")
- Modify: `src/components/dashboard/asset-library.tsx` (credit-line display for `source: "stock"`)
- Test: component test for the picker, following this codebase's existing dialog/picker test conventions

**Interfaces:**
- Consumes: `searchStockPhotos`, `generateImage` (Task 3), `registerSourcedAsset` (Task 4).

- [ ] **Step 1: Locate the current empty-placeholder picker**

Run the grep above; read the component fully before changing it.

- [ ] **Step 2: Add Search and Generate tabs alongside the existing Upload tab**

Follow the codebase's existing tab/segmented-control pattern (`Segmented` from `src/components/ui/misc.tsx`, used elsewhere per the codebase's own conventions). Search tab: a text input pre-filled from `imagePrompt` when present, a "Search" button calling `searchStockPhotos`, a results grid (thumbnail, creator name), clicking a result shows a preview with an explicit "Use this image" button that calls `registerSourcedAsset` with `source: "stock"` and the result's provenance fields, then applies the returned asset to the element — mirroring the existing upload flow's final "apply to element" step exactly (reuse that step, don't reimplement it).

Generate tab: same pre-filled text input, a persistent (not dismissible) notice per the spec's clinical/factual guardrail — visible every time this tab is open, not only the first time — a "Generate" button calling `generateImage`, a preview of the result with "Use this image" (same `registerSourcedAsset` call, `source: "generated"`) and "Regenerate" (calls `generateImage` again, discarding the previous preview) options. When `generateImage` returns the budget-exhausted error, show it inline in this tab only — the Search and Upload tabs remain fully interactive, unaffected.

- [ ] **Step 3: Write the component test**

Assert: a Search result is not applied to the element until "Use this image" is clicked; a Generate result is not applied until the same; the guardrail notice is present on the Generate tab; a budget-exhausted response disables only the Generate tab's action, not Search or Upload.

- [ ] **Step 4: Run the test**

Run whatever command this test file uses.
Expected: PASS

- [ ] **Step 5: Add the stock credit line to the asset library**

Edit `asset-library.tsx`: for any asset with `source === "stock"`, show `Photo by {creator_name} on Pexels` (linking `creator_name` to `creator_page_url` and "Pexels" to `original_page_url`), matching the spec's "attribution stays in the editor, not the stage" decision. Also show a lighter marker (e.g. a small badge) for `source === "generated"` assets, since knowing an image was AI-generated is useful context in the library even without a licensing requirement driving it.

- [ ] **Step 6: Visual verification via the `run` skill**

Author a scene with an AI-generated `imagePrompt` placeholder, open the picker, search Pexels for something, pick a result, confirm it applies and shows correctly on the stage (feathered at the rim per the existing "image is content" rendering — this workstream doesn't touch that rendering path, only how the image gets there). Repeat for Generate. Confirm the credit line appears in the asset library for the stock pick and not for the generated one (aside from its own generated-badge).

- [ ] **Step 7: Commit**

```bash
git add <picker component> src/components/dashboard/asset-library.tsx <test file>
git commit -m "feat: Search and Generate tabs on the image placeholder picker"
```

---

### Task 6: Metrics logging and the 250-generation review checkpoint

**Files:**
- Modify: `src/lib/ai/visuals-sourcing.ts` (`generateImage`) or its caller — decide based on Task 3 Step 3's deferred note
- Modify: `supabase/migrations/0001_captivate_core.sql`'s `ai_generations` table is not touched directly (append-only migrations) — instead extend via a small additive migration if `ai_generations` is the chosen log target, or confirm a dedicated table already covers this via Task 2's `ai_image_budget_month`/`ai_image_usage_daily` (which track dollars/counts, not per-attempt outcome — a per-attempt log is a different shape and likely needs its own table or reuse of `ai_generations` with `kind: 'image_generation'`)

**Interfaces:** none new beyond what Task 2/3 already produce — this task is about recording outcomes, not adding a new mechanism.

- [ ] **Step 1: Decide the log target**

`ai_generations` (existing, `kind text` column) already exists for exactly this purpose — "audit + cost visibility for every model call," per its own migration comment. Confirm it can hold an image generation attempt's `status` (`succeeded`/`failed`), `prompt`, and whether it needs a new nullable `cost_usd` column (it currently has `input_tokens`/`output_tokens`, sized for text-model billing, not dollars) — if so, a small additive migration adds `cost_usd numeric(10,4)` there rather than creating a fourth tracking table alongside Task 2's two.

- [ ] **Step 2: Write the failing test**

```typescript
// tests/unit/visuals-sourcing.test.ts — extend
it("records a generation attempt with outcome and cost", async () => {
  // Call generateImage (mocked provider success), then assert a row was
  // inserted into ai_generations with kind: "image_generation",
  // status: "succeeded", and the reconciled cost.
});
```

- [ ] **Step 3: Wire the insert into `generateImage`**

After both the success and failure paths in Task 3's `generateImage`, insert a row into `ai_generations` (`kind: "image_generation"`, `status`, `prompt`, `model: "gpt-image-2"`, the new `cost_usd` if Step 1 added it, `error_message` on failure) — mirroring however the existing text-generation call sites in `service.ts` already log to this table (`grep -n "ai_generations" src/lib/ai/service.ts` for the exact pattern to match).

- [ ] **Step 4: Run the test**

Run: `npx vitest run tests/unit/visuals-sourcing.test.ts`
Expected: PASS

- [ ] **Step 5: Document the 250-attempt checkpoint outside the codebase**

This is a process step, not code — add a short note to `docs/DATABASE.md` or wherever operational runbooks live in this repo (check for one; `docs/DEPLOYMENT.md` was seen during the earlier project audit) pointing at the `ai_generations` `kind = 'image_generation'` rows as the place to pull acceptance-rate/cost/latency numbers from when that count is reached.

- [ ] **Step 6: Run full unit suite and commit**

```bash
npm run test
git add src/lib/ai/visuals-sourcing.ts <migration if added> docs/DATABASE.md tests/unit/visuals-sourcing.test.ts
git commit -m "feat: log every image generation attempt for the 250-attempt provider review"
```

---

### Task 7: Health-check tie-in (optional, decide during implementation)

**Files:**
- Read: `src/lib/analysis/health.ts` and its "Media described" check
- Modify: same file, only if the check below fits its existing shape

**Interfaces:** none new.

- [ ] **Step 1: Read the existing "Media described" check's shape**

Confirm whether it can be extended to also flag a scene with an unresolved `imagePrompt` placeholder ("this scene wanted an image and doesn't have one yet"), per AGENTS.md's "every non-passing check carries a fix" rule (the fix here is "search or generate," which now exist).

- [ ] **Step 2a: If it fits naturally** — extend it, write the test that fails without the change and passes with it (following `tests/unit/health.test.ts`'s existing pattern), commit.

- [ ] **Step 2b: If it doesn't fit cleanly** — leave it out. The spec explicitly scoped this as a "decide during implementation" item, not a requirement; no change is a valid, honest outcome here, not a gap.

---

## Final verification (all tasks)

- [ ] Run `npm run verify` — must exit 0.
- [ ] Run `npm run test:rls` — must exit 0, including Task 2's concurrency test.
- [ ] Confirm the budget reservation fails closed: temporarily point `OPENAI_API_KEY` at an invalid endpoint or simulate a Supabase RPC error in a test, and confirm `generateImage` denies the call rather than proceeding.
- [ ] Confirm `searchStockPhotos`, direct upload, and browsing existing assets all still work when the monthly budget or a user's daily cap is exhausted — this is acceptance criterion in the spec's section E, not incidental.
- [ ] Live walkthrough via the `run` skill: search, pick, apply; generate, regenerate, apply; confirm the clinical/factual guardrail notice is visible every time the Generate tab opens; confirm the asset library shows correct provenance for both.
