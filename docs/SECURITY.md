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
meaningless — and the row is _reserved_ before the call rather than recorded
after it, which is what makes the number a limit rather than an average. See
"AI spend is bounded by a reservation, not a count" below.

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

The linter's suggested remediation — revoke `EXECUTE`, or switch to `SECURITY
INVOKER` — is not available here, and this was checked rather than assumed:
revoking it against the test database makes every read of `scenes`, `sections`
and `lecture_notes` fail with `permission denied for function
captivate_owns_presentation`. A policy expression is evaluated with the
querying role's privileges, so the grant is load-bearing. Acting on that
warning would not harden anything; it would take the application down.

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

## AI spend is bounded by a reservation, not a count

Model calls are metered against the caller's own rows in `ai_generations`, and
the order of operations is the control. Counting the rows and _then_ letting the
request through leaves the whole model call — seconds of it — as a window in
which the count does not move: a user one call below the limit could fire fifty
requests at once, have all fifty read the same count, and spend all fifty. The
limit bounded sequential use and nothing else.

`captivate_reserve_generation` counts and writes the row in a single
transaction, under a per-user advisory lock, and returns nothing rather than a
ticket when the limit is reached. It fails closed on both sides: no `auth.uid()`
means no ticket, and a client that cannot obtain one does not call the model.

Recording the outcome is a second function rather than an `UPDATE` policy on the
table, because the table deliberately has none — the limiter counts exactly
these rows, so being able to edit them is how a caller would erase their own
spend. `captivate_complete_generation` sets only the outcome columns, only for
the caller's own row, and never touches `kind`, `prompt`, `owner_id` or
`created_at`. A completed row still counts.

That function is called by the server with the author's own JWT, which is also
all a browser needs to call it directly, so it cannot recognise its own caller.
It did not have to until `0018` stopped charging for calls that never reached
the model: `failed` with no output tokens became a terminal state that does not
count, and an author could settle their own in-flight reservation into it, keep
the answer, and repeat without limit. `0020` answers it with ordering rather
than identity. The server settles _after_ the model replies, so the row is left
rewritable exactly while it is not counting against anybody — still in flight,
or sitting in that one skipped state — and final in every state that counts.
The only settlement a later call can overwrite is the one claiming nothing was
owed, and the server's write is the later call. The rule names the non-counting
state rather than "recorded no spend", because an `invalid_output` with no usage
records no spend and still counts; the looser reading left that row rewritable
and handed the forgery back a second time. `ledger_*` in
`rls_isolation.test.sql` walks that sequence; the two probes for it fail against
the previous migration.

Image settlement takes the same shape one step further: it no longer carries a
price at all. `captivate_reserve_image_generation` writes the estimate under the
lock that checked it against the shared monthly budget, and settling records
only how the call went. While the price was a settlement parameter, a caller
could zero their own to release the deployment's budget or inflate it to
exhaust it for everyone.

Both properties are asserted in `supabase/tests/rls_isolation.test.sql`, and the
concurrency property — the one no single-connection probe can show — in
`supabase/tests/reservation_race.sh`, which parks two dozen sessions on a shared
advisory lock and releases them together. Against a limit of one it issues one
ticket; with the lock removed from the function it issues nineteen.

`checkRateLimit` still runs ahead of the reservation in `guard`. It is a cheap
read whose only job is to turn an obviously-over-limit request into a `429` with
a `Retry-After` before the body is parsed; it may fail open, because being wrong
there only means a request is not rejected early. The reservation is the
authoritative one. A request that slips past the pre-filter and is then refused
a ticket currently surfaces as a `502` carrying the correct message rather than
a `429` — the client renders the message either way, but the status is wrong for
that narrow concurrent-burst path.

## Sourced images: two outbound calls and one fetch

Stock search and image generation are the first features that call a third
party other than the model provider, and the first that fetch bytes from a URL
into the app's own storage.

**The fetch is an allowlist of exact hostnames, not a pattern.** `*.pexels.com`
would admit any subdomain a provider — or anyone who can register one — happens
to control. Only `searchStockPhotos` and `generateImage` ever produce a URL to
ingest, both server-side, so anything else reaching `fetchImageBytes` is
refused on the hostname before a request is made. `http`, `file:`, `localhost`
and link-local addresses are all refused by the same check, which is what stops
this becoming a server-side request forgery primitive.

**The byte ceiling is enforced while reading.** A response that never ends is
cancelled mid-stream rather than buffered until it does, and `content-length`
is checked first but never trusted on its own.

**The format comes from the bytes.** `Content-Type` is a claim; the first bytes
are checked against PNG, JPEG and WebP signatures and anything else is refused,
including a file that says `image/png` and is not one.

**Nothing is stored until the author accepts it.** A search result is a
provider thumbnail and a generation is a data URL held in memory. Only on
"use this image" does the server fetch, verify and re-host into the user's own
storage prefix — the same private bucket and signed-URL route as an upload, so
no deck ends up with one picture that is a permanent hotlink into somebody
else's CDN.

**Generation is bounded on two axes, and the refusals are distinguishable.**
The per-user hourly limit that bounds text calls is the wrong shape when the
cost is money and the budget is shared, so `captivate_reserve_image_generation`
checks a global monthly ceiling _and_ a per-user daily count in one locked
statement, and inserts the ledger row that both are measured from. The lock is
global rather than per-user — two different people spending the last of a shared
budget simultaneously is exactly the race a per-user lock would miss. A refusal
says which ceiling was reached, because "the deployment is out of budget" and
"you have used your day's allowance" are different situations and only one of
them is the reader's own doing; both say that search and upload still work, so
a budget problem does not read as "images are broken".

A failed provider call is still charged at the estimate. Charging zero would
make an outage look like free capacity, and retries would burn the month.

**Generated images are labelled as illustrations, permanently.** The notice
under the prompt field is not dismissible, because it is true of every
generated image; a prompt that names an ECG, a dosage, a lab value or a chart
of specific numbers draws a stronger warning _before_ the generation, since a
model has no access to the real trace and will invent one that looks right.
This is a guardrail on use rather than a block: Captivate cannot determine
clinical intent, and false-positive blocking would only route people around it.

**Whole-deck generation still spends nothing.** An AI-generated scene leaves an
image prompt and an empty placeholder, exactly as before. Filling one is always
a separate, per-scene, explicitly chosen action.

## Known gaps

- **Email confirmation uses Supabase's built-in SMTP**, which is rate limited to
  a handful of messages per hour. This is a _deployment_ setting, not a code
  issue; see [DEPLOYMENT.md](DEPLOYMENT.md).
- **No account deletion flow.** Cascading deletes are in place at the database
  level; no UI exposes them.
- **No audit log of sign-ins.** Supabase records them; Captivate does not
  surface them.
- **No global ceiling on _text_ generation.** Images have one
  (`CAPTIVATE_IMAGE_BUDGET_USD`); text is bounded per user only — 30 heavy and
  200 light per hour on Pro, and a rolling 30-day allowance on Free — so total
  text spend still scales with the number of accounts.
  `captivate_reserve_image_generation` is now the worked example of the shape
  this needs — a global counter checked under a global lock in the same
  statement that increments it.
- **The provider review at 250 generations is a process step, not enforced.**
  `ai_generations` records cost, latency and status per attempt, and an attempt
  with no matching `assets` row is one the author discarded, so the acceptance
  rate is queryable. Nothing reminds anyone to look.
- **Leaked-password protection is disabled on the Supabase project.** Supabase
  Auth can check new passwords against HaveIBeenPwned; it is off. This is a
  project setting rather than a code change, and turning it on is strictly a
  hardening step.

## Billing

Subscription state is money, so the rules around it are stricter than the rest
of the app's.

- **The webhook signature is the authentication.** `/api/stripe/webhook` is
  public and unauthenticated by necessity — Stripe calls it. Every request is
  verified with `stripe.webhooks.constructEvent` against
  `STRIPE_WEBHOOK_SECRET`, and an unverified body is a 400 that touches
  nothing.
- **`subscriptions` has no write policy for any role.** Not for the owner, not
  for `authenticated`, not for `anon`. A user who could write their own row
  would grant themselves Pro, so the schema never offers the verb; the webhook
  writes through the service-role client and is the only writer. The RLS suite
  asserts a user can neither update nor insert their own subscription.
- **`stripe_events` has no policies at all**, including select. It exists for
  idempotency and nothing in the app needs to read it.
- **The price is never taken from the client.** `startCheckout` accepts only
  `"month"` or `"year"` and resolves the price id from the environment. A
  caller that names its own price is a caller that sets its own price.
- **The billing portal resolves the customer from the session**, never from a
  request field — a customer id in a request body is one somebody else can
  name.
- **Entitlement fails closed.** A read error, a missing row or an unrecognised
  status all resolve to Free. The single graced case is `past_due`, which keeps
  Pro until the period ends because Stripe is still retrying the card.
- **An unconfigured deployment enforces nothing.** With no `STRIPE_SECRET_KEY`
  every caller resolves to Pro: a deployment that cannot charge must not
  throttle, and a half-finished rollout must not silently limit real users.
