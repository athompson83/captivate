import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The retry has to make a *second request*.
 *
 * `readTwice` exists for one moment: the redirect straight after sign-in, where
 * the session cookie is milliseconds old and a single PostgREST read can come
 * back 401 while the ones either side of it succeed. It is the only read on the
 * home page that throws on failure, so when it loses that race the whole page
 * dies and the author is told their work could not be read.
 *
 * It had been losing it. The builder was constructed *outside* the closure and
 * only `.limit()` was called inside:
 *
 *     let query = supabase.from("presentations").select(...)      // once
 *     await readTwice(() => query.limit(60))                      // "retry"
 *
 * A PostgREST builder is a one-shot thenable. Re-awaiting one that has already
 * resolved returns the same cached result and never touches the network, so the
 * retry replayed the first failure and the function's own comment — "takes a
 * closure rather than a builder because re-awaiting the same object is not a
 * fresh request" — was defeated by its call site.
 *
 * Production confirmed it: four concurrent reads at sign-in, exactly one 401,
 * and no second request for it anywhere in the edge log.
 *
 * So the assertion here is not "does it retry" — the old code retried. It is
 * "does a second builder get made", because that is the difference between a
 * request and a replay. The fake below reproduces the one-shot semantics on
 * purpose: awaiting a builder twice yields the same settled result.
 */

/** Rows the query resolves to once it succeeds. */
const ROW = {
  id: "00000000-0000-4000-8000-000000000001",
  owner_id: "00000000-0000-4000-8000-000000000002",
  folder_id: null,
  title: "A deck",
  description: "",
  theme_id: "midnight",
  theme_overrides: null,
  aspect_ratio: "16:9",
  journey: null,
  target_seconds: 0,
  tags: [],
  is_favorite: false,
  thumbnail_url: null,
  schema_version: 1,
  share_token: null,
  created_at: "2026-01-01T00:00:00Z",
  updated_at: "2026-01-01T00:00:00Z",
  last_opened_at: null,
  folders: null,
  scenes: [{ count: 3 }],
};

/** How many builders were constructed, i.e. how many requests would go out. */
let builders = 0;
/** Results handed to successive builders, in order. */
let outcomes: { data: unknown; error: { message: string } | null }[] = [];

/**
 * A PostgREST-shaped builder that is a one-shot thenable, like the real one.
 *
 * Chainable methods return `this`; the result settles once and is cached, so a
 * test that re-awaits the same object gets the same answer without a new
 * "request" — exactly the trap the production code fell into.
 */
function fakeBuilder() {
  const index = builders;
  builders += 1;
  let settled: Promise<unknown> | null = null;

  const builder: Record<string, unknown> = {
    then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
      settled ??= Promise.resolve(outcomes[Math.min(index, outcomes.length - 1)]);
      return settled.then(onFulfilled, onRejected);
    },
  };
  for (const method of ["select", "eq", "is", "or", "contains", "order", "limit", "maybeSingle"]) {
    builder[method] = () => builder;
  }
  return builder;
}

vi.mock("@/lib/supabase/server", () => ({
  supabaseServer: async () => ({ from: () => fakeBuilder() }),
}));

describe("a read that loses the race just after sign-in", () => {
  beforeEach(() => {
    builders = 0;
    vi.resetModules();
  });

  it("issues a genuinely new request rather than re-awaiting the dead one", async () => {
    // First attempt fails the way production did; the second succeeds.
    outcomes = [
      { data: null, error: { message: "JWT expired" } },
      { data: [ROW], error: null },
    ];

    const { listPresentations } = await import("@/lib/data/presentations");
    const result = await listPresentations({ sort: "recent", limit: 8 });

    // The assertion that matters. One builder means the retry re-awaited a
    // settled thenable and never reached the network.
    expect(builders, "the retry must construct a second query").toBe(2);
    expect(result).toHaveLength(1);
    expect(result[0].title).toBe("A deck");
  });

  it("does not retry a read that worked", async () => {
    outcomes = [{ data: [ROW], error: null }];

    const { listPresentations } = await import("@/lib/data/presentations");
    await listPresentations();

    // A retry on success would double every read on every page.
    expect(builders).toBe(1);
  });

  it("still fails, loudly, when the database is genuinely unavailable", async () => {
    // Both attempts fail. The page must throw into the error boundary rather
    // than render an empty library, which would read as "your work is gone".
    outcomes = [
      { data: null, error: { message: "connection refused" } },
      { data: null, error: { message: "connection refused" } },
    ];

    const { listPresentations } = await import("@/lib/data/presentations");
    await expect(listPresentations()).rejects.toThrow(/connection refused/);
    expect(builders).toBe(2);
  });

  it("names the mistake when a closure hands back the same query twice", async () => {
    // The guard that stops this shipping again. Re-awaiting a settled builder
    // is indistinguishable from a real retry at the call site, so `readTwice`
    // compares references and refuses to pretend it tried.
    const { __readTwiceForTests } = await import("@/lib/data/presentations");
    const settled = Promise.resolve({ data: null, error: { message: "JWT expired" } });

    await expect(__readTwiceForTests(() => settled)).rejects.toThrow(/same query object twice/);
  });

  it("retries every option shape, not just the default one", async () => {
    // The bug lived in the branch that builds filters, so a fix that only
    // covered the plain call would leave search and folder views broken.
    for (const opts of [
      { search: "shock" },
      { folderId: null },
      { favoritesOnly: true },
      { tag: "teaching" },
      { sort: "title" as const },
    ]) {
      builders = 0;
      outcomes = [
        { data: null, error: { message: "JWT expired" } },
        { data: [ROW], error: null },
      ];
      vi.resetModules();
      const { listPresentations } = await import("@/lib/data/presentations");
      await listPresentations(opts);
      expect(builders, `options ${JSON.stringify(opts)} must retry`).toBe(2);
    }
  });
});
