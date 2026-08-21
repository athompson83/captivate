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
`lecture_notes` invoke it. It answers exactly one question — "does the *calling*
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

## Known gaps

- **Email confirmation uses Supabase's built-in SMTP**, which is rate limited to
  a handful of messages per hour. This is a *deployment* setting, not a code
  issue; see [DEPLOYMENT.md](DEPLOYMENT.md).
- **No account deletion flow.** Cascading deletes are in place at the database
  level; no UI exposes them.
- **No audit log of sign-ins.** Supabase records them; Captivate does not
  surface them.
