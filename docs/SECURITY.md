# Security

## Model

Captivate is single-tenant per user. There is no sharing, no team membership and
no public content. Every row and every stored object belongs to exactly one
account, and the only interesting question is whether one account can reach
another's data.

**The authorisation boundary is row-level security in Postgres, not application
code.** Application code can have bugs; a policy that returns zero rows returns
zero rows regardless of what the route handler intended.

---

## Controls

### Row-level security

Enabled on all nine tables. Owner-scoped tables compare `owner_id = auth.uid()`.
Child tables (`sections`, `scenes`) delegate to a single `SECURITY DEFINER`
helper, `captivate_owns_presentation`, so the ownership rule is written down
once rather than nine times.

Ownership is never accepted from a client: `owner_id` defaults to `auth.uid()`
and every `WITH CHECK` clause rejects a write that would attribute a row to
someone else.

`ai_generations` has SELECT and INSERT policies but deliberately no UPDATE or
DELETE — once written, an audit record is immutable from a client.

**Verified, not asserted.** `supabase/tests/rls_isolation.test.sql` runs against
a local Postgres, and the same probes were run against the live project through
the real PostgREST API with two real JWTs. Both confirm that a second user sees
zero rows, cannot read a presentation or its speaker notes by id, cannot insert
into another user's deck (42501), cannot update or delete one, and cannot forge
`owner_id` (42501) — while their own writes work and the first user's data is
untouched.

### Storage

Three private buckets: `assets`, `recordings`, `thumbnails`. No public object
URL is ever produced.

Object keys are always `<user_id>/<uuid>.<ext>`, and the policies compare
`(storage.foldername(name))[1]` to `auth.uid()`. A user cannot write into
another user's prefix even with a forged request body.

Scene content stores a permanent `/api/assets/:id/content` reference rather than
a signed URL, because signed URLs expire and a deck must still render a year
later. That route re-checks ownership through RLS and redirects to a freshly
signed URL. An id belonging to someone else returns 404 — the same response as
an id that does not exist, so the route cannot be used to probe for assets.

### Input validation

Every server action and API route validates with Zod before touching the
database. Zod schemas are also the storage format for scene content, so invalid
content cannot be written even by a compromised client.

Two URL validators exist because `z.url()` is not enough:

- `NavigableUrl` — http and https only. Used for link hrefs and embeds.
  `z.url()` accepts `javascript:alert(1)`, which was rendered straight into an
  anchor before this was caught by a test.
- `MediaSource` — additionally allows the app's own `/api/assets/...` route,
  `data:image/` and `blob:`, and rejects protocol-relative `//host` URLs.

### Rendering

Text is rendered from typed runs, never from HTML. There is no
`dangerouslySetInnerHTML` on the stage, so there is no sanitisation surface.
Stored content containing `<script>` renders as literal characters, asserted by
a test.

Embeds are iframes with `sandbox="allow-scripts allow-same-origin
allow-presentation"` and `referrerPolicy="no-referrer"` — deliberately without
`allow-top-navigation` or `allow-popups`.

### AI routes

Authenticated, rate limited, and validated before a single token is spent.

Rate limiting counts the caller's own `ai_generations` rows in a rolling hour:
30 heavy generations, 200 light ones. It is database-backed rather than
in-memory because serverless instances make per-instance counters close to
meaningless.

The speaker-notes route reads the scene from the database rather than from the
request body, so it cannot be used as a general-purpose summariser.

Model output is validated against a Zod schema and retried once with the
validation error. Invalid output never reaches the document.

### Transport and headers

`Content-Security-Policy` with `frame-ancestors 'none'`, `object-src 'none'`,
`base-uri 'self'`, `form-action 'self'`, and a `connect-src` scoped to the
configured Supabase origin. Plus HSTS with preload, `X-Content-Type-Options:
nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy:
strict-origin-when-cross-origin`, and no `X-Powered-By`.

`Permissions-Policy` grants camera, microphone, display-capture and fullscreen
to this origin only, and denies geolocation, payment and USB outright.

Asserted by an end-to-end test, so a regression fails the build rather than
shipping quietly.

### Auth flows

- Sign-in failures are generic, to prevent account enumeration.
- Password reset always reports success, for the same reason.
- Redirect targets after sign-in and email confirmation are validated as
  same-origin paths, so a crafted link cannot bounce a freshly authenticated
  user to an external site.
- Sign-out is POST-only, so a stray link or image cannot log a user out.
- `getUser()` is used everywhere rather than reading a decoded cookie, because
  a cookie is attacker-controllable and `getUser()` verifies against the auth
  server.

### Secrets

Only `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` reach the
browser. Both are public by design — RLS is the boundary, not key secrecy.

`ANTHROPIC_API_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are read only from modules
marked `server-only`, which makes importing them into a client component a build
error rather than a silent leak. `.env*.local` is gitignored; no credential is
committed.

---

## Accepted risks

**`captivate_owns_presentation` is executable by `authenticated`.** Supabase's
linter flags every `SECURITY DEFINER` function callable over PostgREST. This one
must be callable, because the RLS policies on `sections`, `scenes` and
`lecture_notes` invoke it. It answers exactly one question — "does the _calling_
user own this presentation?" — and is already scoped to `auth.uid()`, so it
leaks nothing. `anon` has been revoked; the trigger functions have had EXECUTE
revoked from all client roles.

**`'unsafe-inline'` in `style-src`.** The stage positions every element with
inline styles, which is what makes normalised geometry work. A nonce-based CSP
would require rewriting the renderer to emit a stylesheet per scene. The
trade-off was taken knowingly; there is no HTML injection surface for it to
combine with.

**No CSRF tokens.** Next.js Server Actions carry their own origin checks, and
the only non-action mutation endpoints are the AI routes, which are
authenticated and rate limited. Auth cookies are `SameSite=Lax`.

**No virus scanning on uploads.** Files are private to the uploader and are
never executed. MIME type and size are validated at three layers.

---

## A deliberately `SECURITY INVOKER` function

`captivate_set_scene_placements(uuid, jsonb)` rewrites the world position of
every scene in a presentation in one statement. Unlike the ownership helpers it
is **`SECURITY INVOKER`**, which is the safe choice rather than the lax one: the
owner-scoped RLS policy on `public.scenes` is exactly the check it needs, so
running as the caller means the check happens once, in the place it is already
defined. A `SECURITY DEFINER` version would have to re-implement that check by
hand and would become a privilege-escalation bug the first time somebody got the
re-implementation wrong. `EXECUTE` is revoked from `public` and granted only to
`authenticated`.

Verified: the function updates rows only where `presentation_id` matches _and_
RLS admits them, so a caller passing another owner's scene ids updates nothing.

## The phone remote is the first transport that leaves the browser

Console-to-stage sync is `BroadcastChannel`: same origin, same browser, no
network for anyone to reach. A phone is a different device, so the remote is the
first thing here that needs an authorisation story rather than inheriting one.

**The topic is named after the session, not the presentation.** A presentation id
is long-lived and appears in ordinary shareable-looking URLs; a channel named
after one would be addressable by anyone who ever saw it, for the life of the
deck. A session id is minted when the presenter asks for a remote and dies when
they disconnect, so most of the time the channel does not exist at all. This is
defence in depth, not the control.

**The control is the policy.** The channel is opened with `config.private: true`,
which makes Realtime check RLS on `realtime.messages` for every join and every
publish rather than admitting anyone who knows the topic name. Both policies
call one function, `captivate_remote_topic_open`, so join and publish cannot
drift apart: the topic must resolve to a session that is the caller's, `active`,
and unexpired. A name that is not ours in shape, a session that does not exist,
one that has ended, one that has expired, and one belonging to someone else all
answer false without saying which.

**The QR code is not a credential.** It encodes the remote route and a session
id, and nothing else. Opening it still requires being signed in as the
presentation's owner, and joining still requires the session to be live — so a
photograph of the code, or a phone someone else picks up, grants nothing. A
token in the code would have been a bearer credential that a photograph leaks;
there is deliberately none to leak.

**The remote route loads no presenter material.** Same load-boundary rule as the
stage, and for a stronger reason: a phone is the device most likely to be handed
to someone. The route loads the deck's title and the session; it does not import
`getPresentationDocument`, `listNotes`, or the console. `tests/unit/
remote-load-boundary.test.ts` reads the module rather than rendering it, because
the claim is about what is imported at all.

**Inbound messages are checked even though the channel should be clean.** A
network can deliver a message twice, late, or after a reconnect flushes a queue
— a duplicated `command` advances two scenes in front of a room, and a flushed
backlog walks the deck forward on its own. `RemoteInbox` rejects a foreign
session, an unrecognised protocol version, a malformed payload, the sender's own
echo, a duplicate id, and anything sent more than thirty seconds ago. Ids are
forgotten by age rather than by count, so the memory and the staleness window
line up exactly and a duplicate cannot slip through by being crowded out — which
a fixed ring would allow, since the laser streams envelopes at frame rate.

**The stage never joins.** A phone's command is applied in the presenter's own
window, through the same session API a keypress uses, and reaches the stage over
the channel that already carries one. The projector gains no network listener,
and presenter-only material gains nowhere new to go.

Fifteen probes in `supabase/tests/rls_isolation.test.sql` cover this, and each of
the gate's three conditions is mutation-checked: removing the owner check, the
`active` check or the expiry check each turns a different probe red.

## Known gaps

- **Email confirmation uses Supabase's built-in SMTP**, which is rate limited to
  a handful of messages per hour. This is a _deployment_ setting, not a code
  issue; see [DEPLOYMENT.md](DEPLOYMENT.md).
- **No account deletion flow.** Cascading deletes are in place at the database
  level; no UI exposes them.
- **No audit log of sign-ins.** Supabase records them; Captivate does not
  surface them.
