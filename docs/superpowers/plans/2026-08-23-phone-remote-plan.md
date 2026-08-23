# Phone Remote Control Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a presenter connect a phone as a remote control (next/prev/blank/laser + scene number) over an ephemeral, owner-authorized Supabase Realtime channel — created only when asked for, torn down on disconnect — without touching the existing same-browser console↔stage `BroadcastChannel` path.

**Architecture:** A new `presentation_sessions` table backs an ephemeral Realtime topic (`config.private: true`, RLS on `realtime.messages` checking session ownership/status/expiry). `PresentMessage` is reused unchanged as the payload inside a new `RemoteEnvelope` (version/session/dedup fields). The stage subscribes to both `BroadcastChannel` (console) and, once connected, the Realtime channel (phone) into the same `session.ts` reducer. A new `/present/[id]/remote` route is the phone-facing UI.

**Tech Stack:** Next.js Server Actions + client components, `@supabase/ssr`'s browser client (`supabaseBrowser()`) for the Realtime connection — Realtime is a persistent client-side WebSocket, not a server action — Supabase Postgres (new table + RLS, including `realtime.messages` policies verified against Supabase's current Realtime Authorization docs), Vitest + Testing Library.

## Global Constraints

- `npm run verify` must pass before any task is considered done, per AGENTS.md.
- The existing console↔stage `BroadcastChannel` path (`protocol.ts`, `session.ts`) is not modified except where explicitly noted (adding a second message source) — no regression risk to already-working same-browser presenting.
- No pairing tokens embedded in the QR link — it is a plain URL; account auth + RLS gate access.
- No native app work of any kind in this plan — Phase 2 is a separate future spec.
- **Test-harness gap found while grounding this plan, relevant to every task below**: `supabase/tests/run.sh` currently applies only `supabase/migrations/0001_captivate_core.sql` against a throwaway database (confirmed by reading the script — it does not loop over later migration files), and its stub (`_supabase_stub.sql`) only covers what migration 0001 touches, not a `realtime` schema. This means:
  - Task 1's plain-table RLS (`presentation_sessions`, an ordinary owner-scoped table) needs `run.sh` fixed to apply *all* migrations in order, not just 0001 — Task 1 includes that fix, since it's a prerequisite for testing anything this plan adds.
  - Task 2's `realtime.messages` policies **cannot** be tested by that lightweight psql-stub harness at all — Supabase Realtime Authorization is enforced by the actual Realtime server evaluating policies against a live WebSocket connection at join time (confirmed against Supabase's current Realtime Authorization docs), not by plain SQL a stub can simulate. Task 2 uses the Supabase CLI's local stack (`supabase start`, which runs a real Realtime server) for that layer specifically — a different, heavier test tier than the rest of this codebase's RLS tests, and worth calling out to the user as new local-dev tooling this plan introduces.

---

### Task 1: `presentation_sessions` table, RLS, and fixing the migration test harness

**Files:**
- Create: `supabase/migrations/00NN_presentation_sessions.sql` (confirm the next free number at implementation time — see the numbering caveat in PR #7/#8's plans, all three land in the same `supabase/migrations/` directory)
- Modify: `supabase/tests/run.sh` (apply every migration, not only `0001_captivate_core.sql`)
- Test: extend `supabase/tests/rls_isolation.test.sql`

**Interfaces:**
- Produces: `presentation_sessions(id, owner_id, presentation_id, status, created_at, expires_at, ended_at)` — consumed by Task 3 (session creation/teardown) and Task 2 (the Realtime RLS policies, which join against this table).

- [ ] **Step 1: Confirm `run.sh` applies every migration (should already be fixed by the prerequisite PR)**

The run.sh gap is a real, verified fix on branch `claude/fix-rls-harness-migration-coverage` ("fix: RLS test harness applies every migration, not only 0001") — merge or rebase onto it before this task. Confirm it landed first (`grep -n "for f in\|0001_captivate_core" supabase/tests/run.sh`); if it already loops over every migration file, skip straight to Step 2. If it's still hardcoded to only `0001_captivate_core.sql` (that prerequisite hasn't merged yet), apply the same fix here — including the `storage.buckets`/`storage.objects` stub addition that PR's `_supabase_stub.sql` change also required for `0002_storage.sql` to apply, not only the loop below:

```bash
psql -q -v ON_ERROR_STOP=1 -d "$DB" -f supabase/migrations/0001_captivate_core.sql
```

with:

```bash
for f in supabase/migrations/*.sql; do
  psql -q -v ON_ERROR_STOP=1 -d "$DB" -f "$f"
done
```

- [ ] **Step 2: Run the existing RLS suite to confirm this fix alone doesn't break anything**

Run: `PGHOST=/tmp PGPORT=<local-postgres-port> PGUSER=postgres ./supabase/tests/run.sh` (match whatever connection details this project's `docs/DATABASE.md` documents for local RLS testing).
Expected: PASS — every migration through the current highest-numbered one applies cleanly and the existing `bob_sees_alice`/`bob_idor`/`bob_delete_alice` probes still return zero rows.

- [ ] **Step 3: Commit the harness fix on its own, before adding this task's actual migration**

```bash
git add supabase/tests/run.sh
git commit -m "fix: RLS test harness applies every migration, not only 0001"
```

(Separated from Step 5's migration so this fix's own correctness is verified in isolation — if Step 5's new migration somehow interacts badly with the harness change, this commit boundary makes that easy to bisect.)

- [ ] **Step 4: Write the failing RLS test for `presentation_sessions`**

Read `supabase/tests/rls_isolation.test.sql`'s existing structure first (it already sets up two test users, "alice" and "bob," per the `bob_sees_alice`-style probe names) and add probes following the exact same pattern:

```sql
-- Appended to rls_isolation.test.sql, following its existing alice/bob setup.
-- Alice creates a presentation_sessions row for her own presentation.
select set_config('request.jwt.claim.sub', '<alice-uuid>', true);
insert into public.presentation_sessions (owner_id, presentation_id, expires_at)
  values ('<alice-uuid>', '<alice-presentation-uuid>', now() + interval '4 hours');

-- Bob must not see it.
select set_config('request.jwt.claim.sub', '<bob-uuid>', true);
select 'bob_sees_alice_session', count(*) from public.presentation_sessions
  where owner_id = '<alice-uuid>';
-- Expected: 0

-- Bob must not be able to create a session row claiming Alice's presentation.
insert into public.presentation_sessions (owner_id, presentation_id, expires_at)
  values ('<bob-uuid>', '<alice-presentation-uuid>', now() + interval '4 hours');
-- Expected: fails (RLS insert check), or succeeds but is invisible/unusable to
-- Alice-owned-presentation lookups — confirm which failure mode the insert
-- policy below actually produces and assert that specific outcome, not a
-- guess.
```

(Fill in real UUIDs matching whatever alice/bob/presentation fixtures the existing file already establishes — do not invent new placeholder users if the file already has them.)

- [ ] **Step 5: Write the migration**

```sql
-- supabase/migrations/0009_presentation_sessions.sql
-- Ephemeral phone-remote sessions.
--
-- Not a permanent channel keyed by presentation id: a presentation's id is
-- long-lived and appears in ordinary shareable-looking URLs, so a Realtime
-- topic derived only from it would be addressable indefinitely by anyone who
-- ever saw that id. This table's random `id` is what the Realtime topic name
-- is actually derived from instead (see the next migration), and a session
-- expires and can be explicitly ended.

create table public.presentation_sessions (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  status          text not null default 'active' check (status in ('active', 'ended')),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  ended_at        timestamptz
);

create index presentation_sessions_owner_idx
  on public.presentation_sessions (owner_id, created_at desc);

alter table public.presentation_sessions enable row level security;

create policy "presentation_sessions_select_own" on public.presentation_sessions
  for select to authenticated using (owner_id = auth.uid());

create policy "presentation_sessions_insert_own" on public.presentation_sessions
  for insert to authenticated with check (
    owner_id = auth.uid()
    and exists (
      select 1 from public.presentations p
      where p.id = presentation_id and p.owner_id = auth.uid()
    )
  );

create policy "presentation_sessions_update_own" on public.presentation_sessions
  for update to authenticated using (owner_id = auth.uid()) with check (owner_id = auth.uid());
```

The `insert` policy's `exists` check matters specifically: it stops a user from creating a session row that *claims* someone else's presentation id even though the row's own `owner_id` is themself — `owner_id = auth.uid()` alone would pass that insert, since nothing else ties `presentation_id` to the inserting user without this extra check.

- [ ] **Step 6: Apply the migration, run the test to verify it passes**

Run: `./supabase/tests/run.sh` (same invocation as Step 2)
Expected: PASS, including the new probes from Step 4.

- [ ] **Step 7: Regenerate TypeScript types if the project has a `db:types`-style script**

Same note as PR #7/#8's plans: check `package.json` for a types-generation script and run it if present.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0009_presentation_sessions.sql supabase/tests/rls_isolation.test.sql
git commit -m "feat: presentation_sessions table for ephemeral phone-remote sessions"
```

---

### Task 2: Realtime channel authorization — `realtime.messages` policies, verified against current Supabase docs

**Files:**
- Create: `supabase/migrations/00NN_remote_realtime_authz.sql`
- Test: new local-stack test — not the `run.sh` psql-stub harness (see the Global Constraints note); requires the Supabase CLI's `supabase start`

**Interfaces:**
- Consumes: `presentation_sessions` (Task 1).
- Produces: the RLS gate every Realtime client-side `channel(topic, { config: { private: true } })` call (Task 3, Task 5) depends on.

**Verified against Supabase's current Realtime Authorization documentation before writing this task** (fetched directly, not recalled from training — Supabase's Realtime feature surface has changed over time and this plan should not guess): private channels require (a) "Allow public access" disabled in the project's Realtime settings — a **dashboard/project-config change, not a migration**, flag this to whoever runs this plan since no SQL file can do it — and (b) explicit `select`/`insert` policies on `realtime.messages` using the `realtime.topic()` helper function, which returns the topic string the connecting client requested. The topic naming convention this plan uses is `captivate-remote-{sessionId}` (parallel to the existing `channelName()` convention in `protocol.ts`, but session-id-based rather than presentation-id-based per Task 1).

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/0010_remote_realtime_authz.sql
-- Realtime private-channel authorization for phone-remote sessions.
--
-- Requires "Allow public access" disabled in this project's Realtime
-- settings (Supabase dashboard, Realtime > Settings) — not something a
-- migration can set; confirm this is done in every environment this
-- deploys to, including any preview/staging Supabase projects, not only
-- production.
--
-- realtime.topic() returns the topic the connecting client requested. This
-- policy accepts only topics of the form 'captivate-remote-{session-uuid}'
-- and only when the requesting user is that session's owner, the session
-- is still active, and it hasn't expired.

create or replace function public.owns_active_remote_session(p_topic text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.presentation_sessions ps
    where ps.id = (regexp_match(p_topic, '^captivate-remote-([0-9a-f-]{36})$'))[1]::uuid
      and ps.owner_id = auth.uid()
      and ps.status = 'active'
      and ps.expires_at > now()
  );
$$;

create policy "remote_session_owner_can_receive"
on "realtime"."messages"
for select
to authenticated
using (
  (select realtime.topic()) like 'captivate-remote-%'
  and realtime.messages.extension in ('broadcast')
  and public.owns_active_remote_session((select realtime.topic()))
);

create policy "remote_session_owner_can_send"
on "realtime"."messages"
for insert
to authenticated
with check (
  (select realtime.topic()) like 'captivate-remote-%'
  and realtime.messages.extension in ('broadcast')
  and public.owns_active_remote_session((select realtime.topic()))
);
```

`owns_active_remote_session` is its own `SECURITY DEFINER` function (pinned `search_path` per AGENTS.md) rather than inlined into the policy, so it's independently unit-testable in Step 3 without needing a live WebSocket connection for that part.

- [ ] **Step 2: Write the failing test for `owns_active_remote_session` (plain SQL, testable in the existing lightweight harness)**

This part *can* use the existing `run.sh` harness, since it's a plain function call, not a live channel join:

```sql
-- Appended to rls_isolation.test.sql (or a new supabase/tests/remote_realtime.test.sql,
-- included by run.sh the same way rls_isolation.test.sql already is — check
-- run.sh's structure after Task 1's Step 1 edit to see whether adding a
-- second -f file there is the right mechanism).

select set_config('request.jwt.claim.sub', '<alice-uuid>', true);
insert into public.presentation_sessions (id, owner_id, presentation_id, expires_at)
  values ('<known-session-uuid>', '<alice-uuid>', '<alice-presentation-uuid>', now() + interval '4 hours');

select 'owner_owns_active_session', public.owns_active_remote_session('captivate-remote-<known-session-uuid>');
-- Expected: true

select set_config('request.jwt.claim.sub', '<bob-uuid>', true);
select 'nonowner_does_not_own_session', public.owns_active_remote_session('captivate-remote-<known-session-uuid>');
-- Expected: false

select 'malformed_topic_rejected', public.owns_active_remote_session('not-a-real-topic');
-- Expected: false (regexp_match returns null, cast fails gracefully — verify
-- this doesn't throw an unhandled error under RLS; if the cast on a null
-- match throws, wrap it so this returns false rather than erroring the
-- whole policy evaluation)
```

- [ ] **Step 3: Run the plain-SQL portion, verify it fails then passes**

Run: `./supabase/tests/run.sh`
Expected: FAIL before the migration exists, PASS after.

- [ ] **Step 4: Set up the Supabase CLI local stack for the live-channel authorization test**

This is new tooling for this codebase — document the setup in this step rather than assuming it: install the Supabase CLI if not already available (`grep -n "supabase" package.json` to check for an existing dev dependency first), run `supabase init` if no `supabase/config.toml` exists yet, `supabase start` to bring up the full local stack (Postgres + Realtime + Auth, not just a bare Postgres instance), apply all migrations against it (`supabase db reset` or equivalent, matching whatever this project's real local-dev flow turns out to be — check `docs/DATABASE.md` again once this step is reached, since Task 1/2 may prompt an update to it).

- [ ] **Step 5: Write the live-channel authorization test**

Using `@supabase/supabase-js` directly in a small Node/Vitest test (not the app's `supabaseBrowser()`/`supabaseServer()` wrappers, since this test needs to authenticate as two different fabricated users against the local stack, not the app's real session handling):

```typescript
// tests/rls/remote-channel-authz.test.ts (new directory — this is a
// different test tier from tests/unit/, talking to a real local Realtime
// server; keep it out of the default `npm run test` vitest include glob,
// matching how `test:rls` is already a separate package.json script from
// `test`)
import { createClient } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";

const LOCAL_URL = process.env.SUPABASE_LOCAL_URL ?? "http://127.0.0.1:54321";
const LOCAL_ANON_KEY = process.env.SUPABASE_LOCAL_ANON_KEY; // from `supabase start`'s output

describe("Realtime private channel authorization", () => {
  it("rejects an anonymous connection", async () => {
    const anon = createClient(LOCAL_URL, LOCAL_ANON_KEY!);
    const channel = anon.channel("captivate-remote-<seeded-session-uuid>", {
      config: { private: true },
    });
    const joined = await new Promise((resolve) => {
      channel.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve(true);
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") resolve(false);
      });
    });
    expect(joined).toBe(false);
  });

  it("allows the session owner to join", async () => {
    // Sign in as the seeded owner user first (real auth flow against the
    // local stack), then join the same channel — expect SUBSCRIBED.
  });

  it("rejects a different authenticated user", async () => {
    // Sign in as a second seeded user; join the same channel — expect
    // CHANNEL_ERROR/TIMED_OUT, not SUBSCRIBED.
  });

  it("rejects joining an expired session's channel", async () => {
    // Seed a presentation_sessions row with expires_at in the past; the
    // owner's own join attempt on its channel must still be rejected.
  });

  it("rejects joining an ended session's channel", async () => {
    // Seed a row with status: 'ended'; owner's join attempt rejected.
  });

  it("isolates two different sessions from each other", async () => {
    // Seed two active sessions for the same owner; join session A's
    // channel, send a broadcast; confirm a client joined to session B's
    // channel never receives it.
  });
});
```

Fill in the sign-in/seeding mechanics once Step 4's local stack is actually running — this is the one part of this plan that genuinely can't be fully written without a live environment to develop against, since Realtime authorization behavior (exact `CHANNEL_ERROR` vs. silent timeout, exact timing) needs to be observed, not guessed.

- [ ] **Step 6: Run the live-channel test suite, verify all pass**

Run: whatever script Step 5's file is wired into (add a `test:realtime` script to `package.json` if this tier doesn't fit `test:rls`'s existing invocation).
Expected: PASS on every case in Step 5.

- [ ] **Step 7: Document the new local-stack requirement**

Add a section to `docs/DATABASE.md` (or wherever `docs/TESTING.md` covers `test:rls` today) explaining this new test tier needs the Supabase CLI and `supabase start`, separate from the existing psql-stub-based RLS tests — a future contributor without the CLI installed should get a clear "install the Supabase CLI" message, not a confusing connection failure.

- [ ] **Step 8: Commit**

```bash
git add supabase/migrations/0010_remote_realtime_authz.sql supabase/tests/ tests/rls/remote-channel-authz.test.ts docs/DATABASE.md package.json
git commit -m "feat: Realtime private-channel authorization for phone-remote sessions, with a live-stack test tier"
```

---

### Task 3: `RemoteEnvelope` — wrap `PresentMessage` for the network

**Files:**
- Create: `src/lib/present/remote-protocol.ts`
- Test: `tests/unit/remote-protocol.test.ts` (new)

**Interfaces:**
- Consumes: `PresentMessage`, `PROTOCOL_VERSION` (both from `protocol.ts` — `PROTOCOL_VERSION` was introduced by the hotspot-elements workstream; if that hasn't landed yet when this task is implemented, add it here instead and note the duplication should be resolved when both branches merge).
- Produces: `RemoteEnvelope`, `wrapEnvelope(payload, sessionId, clientId)`, `RemoteEnvelopeReceiver` (a small stateful dedup/staleness/session/version filter).

- [ ] **Step 1: Write the failing tests**

```typescript
// tests/unit/remote-protocol.test.ts
import { describe, expect, it } from "vitest";
import { RemoteEnvelope, wrapEnvelope, createEnvelopeReceiver } from "@/lib/present/remote-protocol";

describe("RemoteEnvelope", () => {
  it("validates a well-formed envelope", () => {
    const parsed = RemoteEnvelope.safeParse({
      protocolVersion: 1,
      sessionId: "s1",
      clientId: "c1",
      messageId: "m1",
      sentAt: Date.now(),
      payload: { type: "command", action: "next" },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects a malformed payload", () => {
    const parsed = RemoteEnvelope.safeParse({
      protocolVersion: 1,
      sessionId: "s1",
      clientId: "c1",
      messageId: "m1",
      sentAt: Date.now(),
      payload: { type: "not-a-real-type" },
    });
    expect(parsed.success).toBe(false);
  });
});

describe("wrapEnvelope", () => {
  it("stamps a fresh messageId and sentAt", () => {
    const a = wrapEnvelope({ type: "command", action: "next" }, "session-1", "client-1");
    const b = wrapEnvelope({ type: "command", action: "next" }, "session-1", "client-1");
    expect(a.messageId).not.toBe(b.messageId);
    expect(a.sessionId).toBe("session-1");
    expect(a.clientId).toBe("client-1");
  });
});

describe("envelope receiver", () => {
  const session = "session-1";

  it("accepts a fresh, valid envelope for the joined session", () => {
    const receiver = createEnvelopeReceiver(session);
    const env = wrapEnvelope({ type: "command", action: "next" }, session, "client-1");
    expect(receiver.accept(env)).toBe(true);
  });

  it("rejects a duplicate messageId", () => {
    const receiver = createEnvelopeReceiver(session);
    const env = wrapEnvelope({ type: "command", action: "next" }, session, "client-1");
    expect(receiver.accept(env)).toBe(true);
    expect(receiver.accept(env)).toBe(false);
  });

  it("rejects an envelope for a different session", () => {
    const receiver = createEnvelopeReceiver(session);
    const env = wrapEnvelope({ type: "command", action: "next" }, "other-session", "client-1");
    expect(receiver.accept(env)).toBe(false);
  });

  it("rejects an unrecognized protocol version", () => {
    const receiver = createEnvelopeReceiver(session);
    const env = wrapEnvelope({ type: "command", action: "next" }, session, "client-1");
    expect(receiver.accept({ ...env, protocolVersion: 999 })).toBe(false);
  });

  it("rejects a stale envelope", () => {
    const receiver = createEnvelopeReceiver(session);
    const env = wrapEnvelope({ type: "command", action: "next" }, session, "client-1");
    expect(receiver.accept({ ...env, sentAt: Date.now() - 60_000 })).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/remote-protocol.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 3: Implement `remote-protocol.ts`**

```typescript
// src/lib/present/remote-protocol.ts
import { z } from "zod";
import { PresentMessage, PROTOCOL_VERSION } from "./protocol";

export const RemoteEnvelope = z.object({
  protocolVersion: z.number().int(),
  sessionId: z.string().min(1).max(64),
  clientId: z.string().min(1).max(64),
  messageId: z.string().min(1).max(64),
  sentAt: z.number(),
  payload: PresentMessage,
});
export type RemoteEnvelope = z.infer<typeof RemoteEnvelope>;

const STALE_TOLERANCE_MS = 30_000;
const DEDUP_WINDOW = 200;

export function wrapEnvelope(
  payload: PresentMessage,
  sessionId: string,
  clientId: string,
): RemoteEnvelope {
  return {
    protocolVersion: PROTOCOL_VERSION,
    sessionId,
    clientId,
    messageId: crypto.randomUUID(),
    sentAt: Date.now(),
    payload,
  };
}

export interface EnvelopeReceiver {
  accept: (raw: unknown) => boolean;
}

/** Bound to one joined session; rejects anything not addressed to it. */
export function createEnvelopeReceiver(sessionId: string): EnvelopeReceiver {
  const seen = new Set<string>();
  const order: string[] = [];

  return {
    accept(raw: unknown): boolean {
      const parsed = RemoteEnvelope.safeParse(raw);
      if (!parsed.success) return false;
      const env = parsed.data;

      if (env.sessionId !== sessionId) return false;
      if (env.protocolVersion !== PROTOCOL_VERSION) return false;
      if (Date.now() - env.sentAt > STALE_TOLERANCE_MS) return false;
      if (seen.has(env.messageId)) return false;

      seen.add(env.messageId);
      order.push(env.messageId);
      if (order.length > DEDUP_WINDOW) {
        const oldest = order.shift();
        if (oldest) seen.delete(oldest);
      }

      return true;
    },
  };
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/remote-protocol.test.ts`
Expected: PASS

- [ ] **Step 5: Run full unit suite and commit**

```bash
npm run test
git add src/lib/present/remote-protocol.ts tests/unit/remote-protocol.test.ts
git commit -m "feat: RemoteEnvelope wrapping PresentMessage with dedup/staleness/session/version checks"
```

---

### Task 4: Realtime transport client — session lifecycle, lazy connect/teardown

**Files:**
- Create: `src/lib/present/remote-session.ts`
- Modify: `src/lib/present/session.ts` (merge a second inbound message source into the existing reducer)
- Test: `tests/unit/remote-session.test.ts` (new)

**Interfaces:**
- Consumes: `createEnvelopeReceiver`/`wrapEnvelope` (Task 3), `presentation_sessions` (Task 1, via new server actions this task adds), `supabaseBrowser()`.
- Produces: `createRemoteSession(presentationId)` / `endRemoteSession(sessionId)` server actions; a `RemoteTransport` client class with the same duck-typed shape `PresentChannel` already exposes (`post`/`on`/`close`/`connected`/`available`), so `session.ts` can hold one of each without a type-level fork.

- [ ] **Step 1: Add the session-row server actions**

```typescript
// src/lib/data/presentations.ts — add near other presentation actions, or a
// new src/lib/data/remote-sessions.ts if this file is already large; check
// its current line count first (`wc -l src/lib/data/presentations.ts`) and
// follow AGENTS.md's file-size judgment call from there.
"use server";

const SESSION_DURATION_HOURS = 6; // Generous past any real talk's length; confirm this figure during implementation rather than treating it as final.

export async function createRemoteSession(
  presentationId: string,
): Promise<Result<{ sessionId: string; expiresAt: string }>> {
  const parsed = z.string().uuid().safeParse(presentationId);
  if (!parsed.success) return fail("Invalid presentation.");

  const supabase = await supabaseServer();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_HOURS * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("presentation_sessions")
    .insert({ presentation_id: parsed.data, expires_at: expiresAt })
    .select("id, expires_at")
    .single();

  if (error || !data) return fail(error?.message ?? "Couldn't start a remote session.");
  return ok({ sessionId: data.id, expiresAt: data.expires_at });
}

export async function endRemoteSession(sessionId: string): Promise<Result<void>> {
  const parsed = z.string().uuid().safeParse(sessionId);
  if (!parsed.success) return fail("Invalid session.");

  const supabase = await supabaseServer();
  const { error } = await supabase
    .from("presentation_sessions")
    .update({ status: "ended", ended_at: new Date().toISOString() })
    .eq("id", parsed.data);

  if (error) return fail(error.message);
  return ok(undefined);
}
```

(Match `Result<T>`/`ok`/`fail` to whichever helper this codebase's other server actions already use — `data/actions.ts` and `data/assets.ts` use slightly different result-type names per the earlier research; use the one already established in whichever file this ends up living in.)

- [ ] **Step 2: Write the failing tests for `RemoteTransport`**

```typescript
// tests/unit/remote-session.test.ts
import { describe, expect, it, vi } from "vitest";
import { RemoteTransport } from "@/lib/present/remote-session";

// Mock supabaseBrowser()'s .channel()/.subscribe()/.send() surface —
// check whether an existing test already mocks the Supabase Realtime client
// (`grep -rln "channel(" tests/unit/`) and reuse that mock shape.

describe("RemoteTransport", () => {
  it("does not open a channel until connect() is called", () => {
    const transport = new RemoteTransport("session-1");
    expect(transport.connected).toBe(false);
  });

  it("posts through the underlying Realtime channel once connected", async () => {
    // ... mocked channel; assert .send() is called with a wrapped envelope
    // matching Task 3's wrapEnvelope shape.
  });

  it("close() tears down the channel and connected becomes false", async () => {
    // ...
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/remote-session.test.ts`
Expected: FAIL — module doesn't exist.

- [ ] **Step 4: Implement `RemoteTransport`**

```typescript
// src/lib/present/remote-session.ts
"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { PresentMessage } from "./protocol";
import { createEnvelopeReceiver, wrapEnvelope, type RemoteEnvelope } from "./remote-protocol";

/**
 * Realtime-backed transport, matching PresentChannel's duck-typed shape
 * (post/on/close/connected/available) so session.ts can hold one of each
 * without a type-level fork. Unlike PresentChannel, this is opened lazily
 * (connect() is a separate step from construction) and can fail to join —
 * BroadcastChannel never fails synchronously the way a network join can.
 */
export class RemoteTransport {
  private channel: RealtimeChannel | null = null;
  private readonly handlers = new Set<(message: PresentMessage) => void>();
  private readonly clientId = crypto.randomUUID();
  private receiver: ReturnType<typeof createEnvelopeReceiver> | null = null;

  constructor(private readonly sessionId: string) {}

  get available(): boolean {
    return true;
  }

  get connected(): boolean {
    return this.channel !== null;
  }

  connect(onStatus?: (status: "connected" | "error") => void): void {
    if (this.channel) return;
    this.receiver = createEnvelopeReceiver(this.sessionId);

    const topic = `captivate-remote-${this.sessionId}`;
    const channel = supabaseBrowser().channel(topic, { config: { private: true } });

    channel.on("broadcast", { event: "message" }, ({ payload }) => {
      if (!this.receiver!.accept(payload)) return;
      const env = payload as RemoteEnvelope;
      for (const handler of this.handlers) handler(env.payload);
    });

    channel.subscribe((status) => {
      if (status === "SUBSCRIBED") onStatus?.("connected");
      if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") onStatus?.("error");
    });

    this.channel = channel;
  }

  post(message: PresentMessage): void {
    if (!this.channel) return;
    const envelope = wrapEnvelope(message, this.sessionId, this.clientId);
    void this.channel.send({ type: "broadcast", event: "message", payload: envelope });
  }

  on(handler: (message: PresentMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.handlers.clear();
    this.channel?.unsubscribe();
    this.channel = null;
    this.receiver = null;
  }
}
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/remote-session.test.ts`
Expected: PASS

- [ ] **Step 6: Wire a second transport source into `session.ts`**

Read `session.ts`'s current `PresentChannel` construction and message-handling wiring in full before editing (`grep -n "channel\." src/lib/present/session.ts`). Add an optional second transport, only constructed when the stage has an active `presentation_sessions` id (passed in, e.g. via a new `remoteSessionId?: string` parameter on `createSession`/`usePresentSession`, `null` until "Connect phone" is used):

```typescript
  // In createSession, alongside the existing `channel = new PresentChannel(...)`:
  let remoteTransport: RemoteTransport | null = null;

  const connectRemote = (sessionId: string) => {
    remoteTransport = new RemoteTransport(sessionId);
    remoteTransport.on((message) => handleMessage(message, "remote"));
    remoteTransport.connect();
  };

  const disconnectRemote = () => {
    remoteTransport?.close();
    remoteTransport = null;
  };
```

Adapt whatever the existing inbound-message handler function is actually named (the earlier research referenced a `case "command": if (role === "stage") apply(...)` block reached via the `channel.on(...)` registration — confirm its exact name via `grep -n "channel.on(" src/lib/present/session.ts`) so both `channel` (BroadcastChannel) and `remoteTransport` (Realtime) route into it identically. Extend `broadcastState` to also `remoteTransport?.post(...)` the same `state` message it already sends to `channel`, so a connected phone gets the same continuous position updates the console does.

Expose `connectRemote`/`disconnectRemote` on `SessionApi`/`PresentSession`'s public shape, next to `dive` (if the hotspot-elements workstream's `session.ts` changes have landed by the time this is implemented) or next to `toggleOverview` otherwise.

- [ ] **Step 7: Write a session-level integration test**

```typescript
// tests/unit/present.test.ts — extend
it("a command arriving via the remote transport reaches the same reducer as BroadcastChannel", () => {
  // Construct a session, simulate a RemoteTransport delivering a "next"
  // command (bypass the real network — call the registered handler
  // directly, the way this file's existing BroadcastChannel-adjacent tests
  // likely already do; check for that pattern first), assert sceneIndex
  // advances exactly as api.send("next") would.
});
```

- [ ] **Step 8: Run full unit suite and commit**

```bash
npm run test
git add src/lib/data/presentations.ts src/lib/present/remote-session.ts src/lib/present/session.ts tests/unit/remote-session.test.ts tests/unit/present.test.ts
git commit -m "feat: lazy Realtime transport merges into the session reducer alongside BroadcastChannel"
```

---

### Task 5: The `/present/[id]/remote` route — connection UI, controls, laser touchpad

**Files:**
- Create: `src/app/present/[id]/remote/page.tsx`
- Create: `src/components/present/remote-control.tsx`
- Modify: `src/components/present/presenter-bar.tsx` (a "Connect phone" control, showing the QR/link once connected)
- Test: component tests for `remote-control.tsx`

**Interfaces:**
- Consumes: `createRemoteSession`/`endRemoteSession` (Task 4), `RemoteTransport` (Task 4), `session.connectRemote`/`disconnectRemote` (Task 4's `session.ts` additions).

- [ ] **Step 1: "Connect phone" control in the presenter bar**

Edit `presenter-bar.tsx`: add a button (follow the file's existing `BarButton` pattern, `presenter-bar.tsx:307-322` per the earlier research) that calls `createRemoteSession(presentationId)`, then `session.connectRemote(sessionId)`, and shows the resulting link/QR (generate the QR client-side — check whether a QR library is already a dependency, `grep -n "qrcode\|qr-code" package.json`; if not, this is a new small dependency to add, chosen for being lightweight and having no server round-trip requirement since the link itself needs no server-side generation). A "Disconnect" action calls `session.disconnectRemote()` then `endRemoteSession(sessionId)`.

- [ ] **Step 2: The remote route**

```typescript
// src/app/present/[id]/remote/page.tsx
// Server component: verify the requesting user owns the presentation (same
// pattern the existing /present/[id]/console route already uses — read
// that route's auth-check first and mirror it exactly) and the session id
// in the query string, then render the client component with both ids.
```

```typescript
// src/components/present/remote-control.tsx
"use client";
// Connects a RemoteTransport for the given sessionId on mount, tears it
// down on unmount. Renders the five-state connection indicator (section E
// of the spec), large Previous/Next/Blank buttons posting `command`
// envelopes, the current scene number derived from the last received
// `state` message, and the laser touchpad (Step 3).
```

Follow whichever pattern this codebase already uses for a client component that owns a Realtime subscription's lifecycle (`useEffect` mount/unmount, matching `usePresentSession`'s own `useEffect(() => api.attach(), [api])` pattern at `session.ts:533`).

- [ ] **Step 3: Laser touchpad**

```typescript
// Inside remote-control.tsx, or a small extracted LaserTouchpad component.
function useLaserTouchpad(onPointer: (point: { x: number; y: number } | null) => void) {
  const origin = useRef<{ x: number; y: number } | null>(null);
  const current = useRef({ x: 0.5, y: 0.5 });

  const onTouchStart = (e: React.TouchEvent) => {
    const t = e.touches[0];
    origin.current = { x: t.clientX, y: t.clientY };
    current.current = { x: 0.5, y: 0.5 };
    onPointer(current.current);
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (!origin.current) return;
    const t = e.touches[0];
    const SENSITIVITY = 0.0025; // Tune during visual verification, not guessed permanently here.
    const dx = (t.clientX - origin.current.x) * SENSITIVITY;
    const dy = (t.clientY - origin.current.y) * SENSITIVITY;
    origin.current = { x: t.clientX, y: t.clientY };
    current.current = {
      x: Math.min(1.2, Math.max(-0.2, current.current.x + dx)),
      y: Math.min(1.2, Math.max(-0.2, current.current.y + dy)),
    };
    onPointer(current.current);
  };

  const onTouchEnd = () => {
    origin.current = null;
    onPointer(null);
  };

  return { onTouchStart, onTouchMove, onTouchEnd };
}
```

Wire `onPointer` to `session.broadcastPointer(point, "laser", color)` (the existing method on `PresentSession`, per the earlier research at `session.ts:509-513` — reused exactly, no new mechanic, only a new caller) which already posts a `pointer` message through whichever transports are attached, now including the Realtime one from Task 4.

- [ ] **Step 4: Write component tests**

Assert: the connection-state indicator shows "Disconnected" before any transport connects; simulating a "next" tap sends the expected envelope; the laser touchpad's `touchstart`→`touchmove`→`touchend` sequence produces the expected `pointer` sequence ending in `null`.

- [ ] **Step 5: Run tests**

Run whatever command this test file uses.
Expected: PASS

- [ ] **Step 6: Visual verification via the `run` skill**

Two real browser contexts (or a browser + a Playwright phone-width viewport): connect a phone via the real "Connect phone" flow (not a pre-seeded session), confirm Next/Prev/Blank/laser reach the stage, confirm the connection-state indicator reflects reality when the network is throttled/dropped, confirm "Disconnect" actually ends the session (attempting to rejoin the same link afterward should fail per Task 2's RLS).

- [ ] **Step 7: Commit**

```bash
git add src/app/present/[id]/remote/ src/components/present/remote-control.tsx src/components/present/presenter-bar.tsx <test files> package.json
git commit -m "feat: phone remote-control route (connect, controls, laser touchpad)"
```

---

## Final verification (all tasks)

- [ ] Run `npm run verify` — must exit 0.
- [ ] Run `./supabase/tests/run.sh` (now covering every migration, per Task 1) — must pass.
- [ ] Run the Task 2 live-Realtime-stack test tier — must pass, and confirm it's documented well enough that a contributor without the Supabase CLI gets a clear message, not a cryptic connection failure.
- [ ] Confirm the console↔stage `BroadcastChannel` path has zero behavioral change with no phone ever connected — the additive claim in the spec is not "should be fine," it's a specific thing to verify: present solo, confirm nothing about the existing experience differs from before this plan.
- [ ] Confirm "Allow public access" is disabled in every Supabase project's Realtime settings this deploys to (dashboard setting, not code — Task 2 flags this but it bears re-confirming here since it's easy to miss on a new environment).
