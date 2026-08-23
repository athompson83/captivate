# Deployment

## Environment variables

| Variable                        | Required      | Reaches the browser | Purpose                         |
| ------------------------------- | ------------- | ------------------- | ------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Yes           | Yes                 | Project URL                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes           | Yes                 | Publishable key                 |
| `ANTHROPIC_API_KEY`             | No            | **No**              | Enables AI authoring            |
| `CAPTIVATE_AI_MODEL`            | No            | No                  | Overrides the model id          |
| `NEXT_PUBLIC_SITE_URL`          | In production | Yes                 | Absolute origin for email links |
| `SUPABASE_SERVICE_ROLE_KEY`     | No            | **No**              | Not needed by any current route |

`NEXT_PUBLIC_SITE_URL` is required in production rather than merely advisable.
Confirmation and recovery links carry a one-time credential, and the only other
source for the host is `x-forwarded-host` — which is whatever the client sent.
Without the variable set, sign-up and password reset return a configuration
error naming it instead of emailing a link built from a header. A development
server still falls back to its own host, where there is nothing to take.

The two `NEXT_PUBLIC_` values are public by design: row-level security is the
authorisation boundary, not key secrecy. The other two are read only from
modules marked `server-only`, so importing them into a client component is a
build error rather than a silent leak.

Without Supabase configuration the app renders an actionable setup screen naming
the missing variables, rather than throwing on every request.

---

## Database

Apply the migrations in `supabase/migrations/` **in order**. Either paste them
into the Supabase SQL editor, or run them with the Supabase CLI:

```bash
supabase link --project-ref <ref>
supabase db push
```

| Migration                 | Contents                                                 |
| ------------------------- | -------------------------------------------------------- |
| `0001_captivate_core.sql` | Tables, indexes, triggers, and RLS on all nine tables    |
| `0002_storage.sql`        | Three private buckets and their per-user object policies |

A third hardening step is applied on top in the live project and is folded into
`0001`: `search_path` pinned on every function, and EXECUTE revoked from `anon`
and `authenticated` on the trigger functions, which Supabase otherwise exposes
at `/rest/v1/rpc/<name>`.

### Verify it worked

```bash
# Against a local Postgres, with a Supabase-shaped stub:
PGHOST=/tmp PGPORT=55432 PGUSER=postgres ./supabase/tests/run.sh
```

This creates two users and asserts that neither can read, write, update or
delete the other's presentations, scenes or notes, and that neither can forge
`owner_id`. It exits non-zero on any leak.

---

## Two auth settings that need attention

Both are configured in the Supabase dashboard, not in code.

### 1. Email confirmation

By default, **Confirm email** is on and Supabase's built-in SMTP is rate limited
to roughly three messages per hour. That is fine for testing and unusable for
real onboarding — the fourth person to sign up simply never receives a link.

Pick one:

- **Configure custom SMTP** (Authentication → Emails). The correct answer for
  anything real. Any transactional provider works.
- **Turn off Confirm email** (Authentication → Sign In / Providers → Email).
  Signup becomes instant. The trade-off is unverified addresses, which for a
  single-tenant tool with no sharing is a modest risk.

Captivate handles both correctly with no code change: when Supabase returns a
user without a session it shows "check your inbox"; when it returns a session it
signs the user straight in.

### 2. Redirect URLs

Add your deployment origin to **Authentication → URL Configuration → Redirect
URLs**, including `https://<your-host>/auth/callback`. Confirmation and recovery
links fail silently otherwise.

Set `NEXT_PUBLIC_SITE_URL` to the same origin so the app builds absolute links
rather than inferring them from request headers.

---

## Hosting

The app is a standard Next.js 16 App Router project with no custom server. It
runs anywhere Next runs; Vercel needs no configuration beyond the environment
variables.

### Deploying to Vercel

1. **Import the repository.** Vercel dashboard → Add New → Project → import
   `athompson83/captivate`. Framework detection picks Next.js; the defaults are
   correct.
2. **Add the environment variables** from the table above, for Production,
   Preview and Development.
3. **Deploy.** The build runs `next build`.
4. **Add the resulting origin** to Supabase's redirect URL allowlist, and set
   `NEXT_PUBLIC_SITE_URL`.

> **Note.** This step could not be completed automatically. The Vercel
> connection available to this workspace returns
> `403 forbidden … resource: project` on project creation, so the project has to
> be imported once by hand. Everything after that is automatic on push.

### Build characteristics

- All authenticated routes are dynamic (`force-dynamic`) — they read
  per-request auth state, so caching them would be wrong.
- The landing page and the auth pages are static.
- Security headers are set in `next.config.ts` and apply to every response.

---

## After deploying

Run the end-to-end suite against the deployment:

```bash
CAPTIVATE_E2E_URL=https://your-host npx playwright test --project=smoke
```

The smoke suite needs no account and checks that pages render, that the security
headers are present, that focus is visible, that there are no console errors,
that nothing overflows on a narrow viewport, and that both colour schemes and
reduced motion work.

For the full journeys, add credentials:

```bash
CAPTIVATE_E2E_URL=https://your-host \
CAPTIVATE_E2E_EMAIL=you@example.com \
CAPTIVATE_E2E_PASSWORD=... \
npx playwright test --project=authenticated
```

They are skipped rather than failed when credentials are absent, so the suite
never produces misleading red on a machine without an account.

---

## Local development

```bash
npm install
cp .env.example .env.local     # fill in the two Supabase values
npm run dev
```

Presenter mode needs two windows; both must be same-origin, so use the same
`localhost:3000` for each. Recording needs a secure context — `localhost` counts
as secure, so screen capture, microphone and camera all work in development.

Before pushing:

```bash
npm run verify     # typecheck, lint, unit tests, build
```

---

## Deployment protection

Preview deployments on this project have Vercel's deployment protection turned
on, so opening a preview URL redirects to a Vercel login and only members of the
owning account get through. That is a sensible default for an unreleased
product, and it is worth knowing before sending a preview link to anyone: they
will see a login page, not the app.

Two ways to share one:

- **Vercel dashboard → Project → Settings → Deployment Protection**, set preview
  protection to off (or to password), which makes the URL publicly reachable;
- **Protection Bypass for Automation**, which issues a token to append to the
  URL and leaves the protection in place for everyone else.

Neither is a code change, and neither affects production behaviour.
