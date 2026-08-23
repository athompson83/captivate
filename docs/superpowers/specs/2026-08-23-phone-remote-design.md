# Phone remote control — design

Workstream 4 of 4 (see `2026-08-23-premium-chrome-design.md` for the full
list). Scopes "need a way to control presentation from a phone app."

## Problem

Presenter-console-to-stage sync (`src/lib/present/protocol.ts`) is
deliberately same-origin only: `PresentChannel` wraps the browser's
`BroadcastChannel`, which cannot cross devices by design (the file's own
comment: "no server, no network, and no way for another site to join the
channel"). A phone is a different device, so today it simply cannot control
a presentation — there's no cross-device transport anywhere in the codebase
(confirmed: no Realtime/WebSocket usage exists yet, despite Supabase already
being the backend for everything else).

## Decisions made with the user

1. **Scope of control: remote-control basics** — large next/prev/blank/laser
   controls and the current scene number, built for glancing at while
   walking a room. Not the full console (speaker notes, timer, thumbnail
   navigator) — `presenter-console.tsx` is 823 lines built desktop-first;
   reflowing all of it for a phone is out of scope here.
2. **Both a mobile web page and a native app, eventually** — this spec
   designs and implements the mobile web page (fastest to ship, reuses the
   existing Next.js/Supabase stack, installable via "Add to Home Screen").
   The native app is scoped as **Phase 2**, described at the end but not
   fully designed — it depends on the transport this spec builds, and
   deserves its own spec once the web version is proven (app-store presence,
   build/release pipeline, and push notifications are all real unknowns
   better tackled once, not guessed at alongside everything else here).

## Design

### A. Transport: Supabase Realtime alongside `BroadcastChannel`, not instead of it

The console and stage keep using `BroadcastChannel` exactly as today — zero
regression risk to already-working same-browser presenting. The stage
additionally subscribes to a **Supabase Realtime broadcast channel** scoped
to the presentation, and merges messages from both sources into the same
handling path it already has. This is additive: `PresentMessage`
(`protocol.ts:72`) — the validated discriminated union for `state`,
`command`, `pointer`, `annotations`, `recording` — is reused unchanged. A
phone sending a `command` (`next`/`prev`/`goto`/.../`blank`/`overview` —
already exactly the action set "remote-control basics" needs, per
`protocol.ts:113-123`) needs no new message shape; the stage needs no new
handling logic, only a second source feeding the same handler.

Concretely: extract the duck-typed shape `PresentChannel` already exposes
(`post`/`on`/`close`/`connected`/`available`) into an interface, and add a
second implementation backed by Supabase Realtime's broadcast API
(`supabase.channel(name).on('broadcast', ...)`/`.send(...)`), reusing
`channelName(presentationId)` (`protocol.ts:153`) as the shared naming
convention between both transports. The stage-owning code (currently
wherever `present-root.tsx` constructs its `PresentChannel`) constructs both
and forwards inbound messages from either into the same reducer, and posts
outbound `state` updates to both — so a connected phone sees the same scene
position/pause state the console already does, using the existing `state`
message, no new one needed.

### B. Security: this is the one place a wrong default is dangerous

Supabase Realtime broadcast channels, if left at default settings, are
joinable by anyone who knows the channel name — and `channelName()` is
derived from the presentation's UUID, which is not secret (it appears in
shareable-looking URLs). Per `docs/SECURITY.md`'s stated boundary ("row level
security is the boundary, not key secrecy"), this must use Supabase
Realtime's **authorized/private channels** (RLS-backed channel
authorization, gated the same way every other table already is — owner-only)
rather than a bare public broadcast topic. Getting this wrong would let
anyone holding a presentation's URL inject `command` messages into a live
talk and hijack the stage mid-presentation. This is a hard requirement, not
an optimization — flag it explicitly in the implementation plan and verify
it (attempt to join as a non-owner in a test, confirm it's rejected) before
calling this workstream done.

### C. The remote route

New route, `/present/[id]/remote`, structurally parallel to `/console`
(`docs/UX.md`'s "presenter and stage are different routes" pattern extends
naturally here: the remote route imports only what remote-control-basics
needs, never speaker notes or the navigator, so there's nothing sensitive to
leak even by mistake). Requires the same owner-scoped auth every other
authenticated route already requires — no separate pairing code or QR flow;
the presenter logs into their own phone the same way they'd log into any
other device, and RLS already ensures only the owner's session can act on
their presentation.

UI: current scene number, large touch targets (well over the existing 28px
interactive-control minimum — a phone glanced at mid-room needs bigger, not
just compliant) for Previous/Next, Blank, and a laser-pointer toggle (posts
`pointer` messages exactly like the console already does — no new mechanic,
just a new sender). Per `docs/UX.md`'s "Honest about limits," the remote
must show a clear connected/disconnected state — unlike `BroadcastChannel`,
a network channel can drop (phone loses signal, backgrounds the tab), and a
presenter tapping "Next" into a dead connection with no feedback is worse
than not having the feature.

### D. Reliability

Realtime (network) is not as forgiving as `BroadcastChannel` (in-process).
The implementation needs: reconnect-with-backoff on the phone's channel
client, a visible stale/disconnected indicator (per C), and a
sends-don't-assume-delivery posture — since `state` already flows
stage→phone continuously (any time a scene changes), a brief drop
self-heals on reconnect without needing message-level acknowledgement.

## Non-goals (this spec)

- No full console mirrored to phone — remote-control basics only, per the
  scope decision above.
- No native app — Phase 2, below.
- No pairing codes/QR-code auth — reuses existing account auth.
- No changes to the console↔stage `BroadcastChannel` path — additive only.

## Phase 2 (future spec, not designed here): native app

Once the web remote's transport (Realtime broadcast, authorized channels,
the `PresentMessage` reuse) is validated, a native app is most naturally a
thin wrapper: either an installable-web-app-first approach (the mobile route
from this spec, wrapped for app-store presence) or a small React
Native/Expo shell that speaks the same Realtime channel directly using the
same `PresentMessage` protocol — Expo tooling is available in this
environment if that path is chosen. Either way, the protocol and security
model this spec establishes is what a native app would build on, which is
why sequencing web-first here matters: it validates the transport once
instead of designing it twice.

## Testing

- Transport: unit tests for the new Realtime-backed channel implementation
  against the same interface contract `PresentChannel` is already tested
  against, plus a specific test that a non-owner cannot join/post to a
  presentation's channel (the security requirement in B is not "done" until
  this test exists and passes).
- Integration: a simulated stage + simulated phone client exchanging
  `command`/`state` messages, verifying the stage's existing session
  reducer (`session.ts`) reaches the same state regardless of which
  transport a `command` arrived on.
- Visual/manual verification via the `run` skill: two real browser contexts
  (or a browser + a phone-width viewport) — confirm Next/Prev/Blank/laser
  from the "phone" reach the stage, and confirm the disconnected state
  renders correctly when the network channel is torn down.
- `npm run verify` gate per AGENTS.md.

## Risks

- **Security default (see B)** is the primary risk in this workstream —
  get the Realtime channel authorization wrong and this feature becomes a
  way for a stranger to hijack a live presentation, not just an
  inconvenience.
- **A second persistent connection per present session.** Every present
  session now opens a Realtime connection in addition to existing work, even
  when no phone ever connects — confirm this is an acceptable always-on cost
  during implementation rather than assuming it; a lazy "connect only once a
  phone has ever paired" alternative exists if it isn't.
- **Network reliability** in venues with poor phone signal/wifi is a real
  failure mode a same-browser `BroadcastChannel` never had to handle — the
  disconnected-state UI (C, D) is what keeps this honest rather than
  silently unreliable.
