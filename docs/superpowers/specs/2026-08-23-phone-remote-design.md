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

### A. An ephemeral session topic, not a permanent channel keyed by presentation id

The first draft of this spec proposed deriving the Realtime channel name
directly from `channelName(presentationId)` — the same naming convention
`BroadcastChannel` already uses. On review that's the wrong shape for a
network-reachable channel specifically: a presentation's id is long-lived
(it never changes for the life of the deck) and appears in ordinary,
shareable-looking URLs, so a permanent channel keyed only by it is
effectively addressable forever by anyone who ever saw that id, independent
of whether channel *authorization* (section B) is later configured
correctly — defense in depth, not a replacement for section B, but a real
second layer: even a misconfigured authorization check is less exposed
against a channel that doesn't exist most of the time and rotates when it
does.

**New table, `presentation_sessions`** (owner-scoped like every other
table, RLS per AGENTS.md's database rule):

```sql
create table public.presentation_sessions (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null default auth.uid() references auth.users(id) on delete cascade,
  presentation_id uuid not null references public.presentations(id) on delete cascade,
  status          text not null default 'active' check (status in ('active', 'ended')),
  created_at      timestamptz not null default now(),
  expires_at      timestamptz not null,
  ended_at        timestamptz
);
```

`id` is the random, unguessable session id the Realtime topic name is
actually derived from (e.g. `captivate-remote-{id}`, not
`captivate-remote-{presentationId}`) — a new value every time a presenter
starts a remote session, not a stable secret to protect forever.
`expires_at` bounds how long a session can be joined at all (a generous
window past a typical talk's length, confirmed at implementation time — long
enough that a talk running over doesn't get cut off, short enough that a
session from last month can't still be joined). `ended_at` is set when the
presenter explicitly disconnects or the stage window closes.

### B. Lazy creation, explicit teardown

The stage does **not** open a Realtime connection for every present session
by default — only when the presenter takes the explicit "Connect phone"
action (presenter-bar or console control). At that point: insert a
`presentation_sessions` row (owner-scoped, so only the presentation's owner
can create one for it), open the Realtime channel for that session's `id`,
and show the QR/link (section E). Ending the connection (an explicit
"Disconnect" action, or the stage window closing) sets `status: 'ended'`,
`ended_at: now()`, and closes the Realtime channel. This resolves the first
draft's open risk ("a second persistent connection per present session,
even when no phone ever connects") by construction rather than by tuning —
there is no connection to begin with until asked for.

### C. Realtime channel authorization: private channels, RLS on `realtime.messages`

Per `docs/SECURITY.md`'s stated boundary ("row level security is the
boundary, not key secrecy"), the channel must be created with
`config.private: true` (Supabase Realtime's authorized-channel mode, which
requires every join and every message to pass an RLS check rather than
being open to anyone who knows the topic name) — public/unauthenticated
broadcast access is disabled entirely for this channel. Two explicit
policies on `realtime.messages`, scoped to this feature's channel-naming
convention:

- **select** (join/subscribe): permitted only when the requesting user is
  the `owner_id` of the `presentation_sessions` row the channel name
  resolves to, `status = 'active'`, and `now() < expires_at`.
- **insert** (publish): the same condition — only the owner may publish,
  which in practice means only the stage window and the phone(s) the owner
  themself opened the remote link from, since both authenticate as the
  owner's own account (section E — no separate device identity).

This is stricter than "authenticated users can join" — it is "only this
specific presentation's owner, only while this specific session is active
and unexpired." A non-owner, an anonymous connection, or a request against
an expired/ended session must all be rejected at the RLS layer itself, not
by client-side checks that a malicious client could simply skip.

### D. Envelope: `PresentMessage` stays the payload, wrapped for the network

`PresentMessage` (`protocol.ts:72`) — `state`/`command`/`pointer`/
`annotations`/`recording` — is reused unchanged as the *content* of what
crosses the network, exactly as the first draft proposed. What changes: it
travels inside an envelope, not bare, because a network transport has
failure modes `BroadcastChannel` structurally cannot (duplicate delivery,
out-of-order delivery, a stale client replaying an old session):

```ts
interface RemoteEnvelope {
  protocolVersion: number; // see below
  sessionId: string; // the presentation_sessions.id this envelope belongs to
  clientId: string; // random, generated once per phone connection
  messageId: string; // random, unique per envelope — the dedup key
  sentAt: number; // epoch ms
  payload: PresentMessage;
}
```

`protocolVersion` reuses the exact constant introduced in the
hotspot-elements spec/workstream (`PROTOCOL_VERSION`, `protocol.ts`) rather
than inventing a second version number — that spec added it specifically so
a later protocol-shape change (this one) would have a precedent to build on.
The receiving side (the stage, for inbound `command`/`pointer`; the phone,
for inbound `state`):

- **Rejects** an envelope whose `sessionId` doesn't match the session it
  opened the channel for (defense in depth again — RLS in section C should
  already prevent a wrong-session message from arriving, but the receiver
  checks anyway rather than trusting the transport layer alone), whose
  `protocolVersion` it doesn't understand (unknown/newer than what this
  build speaks — degrade by ignoring, not by crashing), or that fails
  `PresentMessage`'s own schema validation (malformed).
- **Deduplicates** by `messageId` — a small ring buffer of recently-seen
  ids (bounded, e.g. the last 200) is enough; Realtime's own delivery
  guarantees don't need to be perfect for this to be correct, since a
  duplicate `command` applied twice would otherwise double-advance the
  scene.
- **Rejects as stale** an envelope whose `sentAt` is further in the past
  than a small tolerance (e.g. 30 seconds) — a reconnect that replays a
  backlog of queued sends should not cause a burst of old commands to fire
  in sequence against the now-current state.

### E. Connection lifecycle and the state machine the UI reflects

Five states, shown distinctly in the remote route's UI (not collapsed into
a single spinner):

1. **Disconnected** — no channel joined (initial load, or after an
   unrecoverable failure).
2. **Reconnecting** — a previously-joined channel dropped; retrying with
   backoff.
3. **Connected** — channel joined, no command currently in flight.
4. **Sent, unconfirmed** — the phone has sent a `command` envelope and is
   waiting.
5. **Confirmed** — resolved back to Connected once confirmation arrives (see
   below); this is a transient visual acknowledgement (e.g. a brief
   checkmark), not a persistent fifth resting state.

**Realtime's own delivery acknowledgement is not proof the stage acted on a
command** — it only proves the message reached the Realtime service, not
that the stage window processed it (the stage could be closed, frozen, or
on an old build that rejects the envelope per section D). The actual
confirmation a phone waits for is the **stage's next `state` broadcast**
whose content reflects the command having been applied (e.g. after sending
`next`, the phone watches for a `state` message with the expected new
`sceneIndex`) — this is the only honest signal that the command was really
processed, and it's free: `state` already flows continuously today. A
timeout with no matching `state` update (a few seconds) falls back to
"Connected" with an inline "didn't confirm — try again" rather than hanging
in "Sent, unconfirmed" forever.

### F. The remote route and QR pairing

New route, `/present/[id]/remote`, structurally parallel to `/console`
(`docs/UX.md`'s "presenter and stage are different routes" pattern extends
naturally here: the remote route imports only what remote-control-basics
needs, never speaker notes or the navigator). **The QR code / deep link
shown when the presenter connects a phone (section B) carries no authority
of its own** — it is a plain link to `/present/[id]/remote?session={id}`,
nothing else encoded in it (no token, no secret). Scanning it and opening
the link still requires the phone to be logged into the presenter's own
Captivate account — the same owner-scoped auth every other authenticated
route already requires. This is deliberate: a token embedded in a QR code
is a bearer credential that a photo of the code (or a compromised phone)
would leak; requiring the *account* to authenticate means the QR is
convenience (skip typing a URL), not security (that's the RLS in section C
plus ordinary login).

UI: current scene number, large touch targets (well over the existing 28px
interactive-control minimum — a phone glanced at mid-room needs bigger, not
just compliant) for Previous/Next, Blank, and the laser touchpad (section
G), plus the connection-state indicator from section E.

### G. Laser: a relative-motion touchpad, not absolute coordinates

The first draft left "how the phone controls the laser pointer" entirely
unspecified. It is **not** the phone's gyroscope/orientation sensors (no
motion-control aiming in MVP — a real, separate feature with its own
calibration problems, not something to half-build here) and it is **not**
attempting to map an absolute touch position on the phone's small screen to
an absolute position on the stage's much-wider aspect ratio (the phone
screen and the presentation canvas have unrelated dimensions and aspect
ratios, so an absolute mapping is either wrong or requires the phone to
somehow show a live mirror of the stage, which is out of scope for
"remote-control basics").

Instead: a **touchpad**, matching how a real laser pointer or a trackpad
already works. A dedicated touch-target area on the remote route tracks
finger movement *deltas* while a finger is down (`touchmove`'s
frame-to-frame `clientX`/`clientY` difference, scaled by a fixed
sensitivity factor), accumulating into a normalized `{ x, y }` position
(the same `NormalisedPoint` shape `protocol.ts:21-25` already defines for
`pointer` messages, clamped to its existing `-0.2..1.2` range) that starts
centered (`{ x: 0.5, y: 0.5 }`) each time a touch begins. **The pointer is
only active while a finger is actually touching the pad** — lifting the
finger immediately sends `pointer: { point: null, ... }` (the existing
"hidden" state the `pointer` message already supports). This is not "active
only while a button is held" in the desktop sense — read
`annotation-layer.tsx`'s actual laser handling (`onPointerDown`/
`onPointerMove`/`onPointerUp`, `annotation-layer.tsx:82-171`) and its own
comment: on the console, the laser follows the mouse on hover *regardless*
of whether a button is held, and only clears on pointer-up/pointer-leave —
there is no "held" state on desktop to mirror. A touchscreen has no hover at
all, so touch-presence is the correct equivalent of that hover state, not a
new, different interaction model — "send `pointer` continuously while a
finger is down, clear it the instant contact ends" is the direct translation
of the desktop behavior into a medium that only has "touching" and "not
touching," not an approximation of some other, button-based behavior that
doesn't actually exist in the code being mirrored. Sent as ordinary
`pointer` envelopes (section D) — no new message type, ordinary
`PresentMessage` reuse.

## Non-goals (this spec)

- No full console mirrored to phone — remote-control basics only, per the
  scope decision above.
- No native app — Phase 2, below, and explicitly not touched by any task in
  this spec's implementation.
- No pairing codes or tokens embedded in the QR link — it grants no
  authority by itself; account auth plus RLS are what actually gate access
  (section F).
- No changes to the console↔stage `BroadcastChannel` path — additive only,
  and this amendment's ephemeral-session redesign (A-D) applies only to the
  new Realtime transport, not to the existing same-browser path.
- No gyroscope/motion-control laser aiming — relative-motion touchpad only
  (section G).
- No transport-level acknowledgement treated as proof of stage action — the
  `state` echo is the only thing that counts (section E).

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

- **RLS on `presentation_sessions` and `realtime.messages`** (section C) —
  the security requirement is not "done" until every one of these passes:
  - The owner can create a `presentation_sessions` row and join/publish on
    its channel.
  - An anonymous (unauthenticated) connection is rejected outright.
  - A different, non-owner authenticated user is rejected.
  - A join/publish attempt against an `expired_at`-passed session is
    rejected, even for the real owner.
  - A join/publish attempt against a `status: 'ended'` session is rejected.
  - Two different presentations' sessions are isolated from each other — a
    client joined to session A's channel never receives or can inject
    messages into session B's, confirmed with two live sessions in the same
    test run, not just by inspecting policy SQL.
- **Envelope handling** (section D): a duplicate `messageId` is processed
  once, not twice; an envelope for a different `sessionId` than the one the
  receiver joined is dropped; an envelope with an unrecognized
  `protocolVersion` is dropped without crashing the receiver; a `sentAt`
  older than the staleness tolerance is dropped even if otherwise valid.
- **Connection state machine** (section E): a simulated command send moves
  the UI to "sent, unconfirmed"; a matching `state` broadcast arriving moves
  it to "confirmed" then back to "connected"; no matching `state` within the
  timeout falls back to "connected" with a retry affordance, never hangs.
- **Laser touchpad** (section G): a simulated `touchstart`/`touchmove`
  sequence produces `pointer` messages with the expected accumulated
  `NormalisedPoint`, clamped to its existing range; `touchend` immediately
  sends `point: null`.
- Integration: a simulated stage + simulated phone client exchanging
  envelope-wrapped `command`/`state` messages, verifying the stage's
  existing session reducer (`session.ts`) reaches the same state regardless
  of which transport a `command` arrived on.
- Visual/manual verification via the `run` skill: two real browser contexts
  (or a browser + a phone-width viewport) — connect a phone via the actual
  "Connect phone" action (not a pre-seeded session), confirm
  Next/Prev/Blank/laser from the "phone" reach the stage, confirm
  disconnected/reconnecting states render correctly when the network channel
  is torn down mid-session, and confirm the session row's `status` flips to
  `'ended'` on explicit disconnect.
- `npm run verify` gate per AGENTS.md.

## Risks

- **Security default (see C)** is still the primary risk in this
  workstream — get the Realtime private-channel/RLS configuration wrong and
  this feature becomes a way for a stranger to hijack a live presentation,
  not just an inconvenience. The ephemeral-session redesign (A) reduces the
  blast radius of a misconfiguration but does not replace getting C right.
- **A second persistent connection, now scoped to when it's actually
  needed.** Section B's lazy creation resolves the original draft's "always-
  on cost" risk by construction — the residual risk is smaller: confirm at
  implementation time that a presenter who connects a phone and then forgets
  to disconnect doesn't leave the channel open indefinitely; `expires_at`
  (section A) is the backstop, not the primary control, so it needs a
  sensible default duration, not an unbounded one.
- **Network reliability** in venues with poor phone signal/wifi is a real
  failure mode a same-browser `BroadcastChannel` never had to handle — the
  disconnected/reconnecting state UI (E) is what keeps this honest rather
  than silently unreliable.
- **Envelope/dedup bookkeeping is new complexity** (section D) — a
  dedup-window bug (too small, evicting a still-relevant id; too large,
  wasting memory over a long session) is a subtler failure mode than a
  missing feature, worth explicit test coverage rather than "it seemed to
  work in manual testing."

---

## What shipped, and where it differs from the above

This section is the record of implementation, added when the feature landed.
The design above is unchanged; these are the places the built thing is not what
the text says, so the document stays accurate about the code.

- **One migration, not two.** The plan split the table and the Realtime
  policies across two files. They are one, `0014_remote_sessions.sql`, because
  the policies are meaningless without the table and applying half of it leaves
  a channel with no gate. The numbering in that plan (`0009`/`0010`) was taken
  by share links and transcripts in the meantime.
- **The insert policy carries an extra condition** the design did not name:
  `captivate_owns_presentation(presentation_id)`. Owning the row is not enough —
  without it a signed-in user could mint a session naming someone else's deck.
- **Deduplication is by age, not by count.** The design proposed a ring buffer
  of the last 200 ids. That is wrong here: the laser streams pointer envelopes
  at frame rate, so a couple of seconds of pointing evicts the command that
  preceded it and a duplicate of that command then advances the scene again.
  Ids are forgotten once they pass the staleness window instead, so the memory
  and the relevance window line up exactly.
- **Blank is the one control the phone cannot confirm.** The design's
  state-echo acknowledgement (section E) works for next/prev, which change
  `sceneIndex`. The stage's `state` message carries no blanked flag, so the
  phone reports that press as sent rather than claiming a confirmation it did
  not receive. Adding one to the protocol would be an additive, defaulted field
  — worth doing, not done here.
- **Not verified live.** The authorisation is tested against real Postgres and
  each condition is mutation-checked; the envelope handling is unit-tested. The
  round trip through Supabase's actual Realtime service is not, because that
  needs two authenticated devices against a deployed instance.
