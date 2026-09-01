# Deployment

## Environment variables

| Variable                        | Required      | Reaches the browser | Purpose                                                         |
| ------------------------------- | ------------- | ------------------- | --------------------------------------------------------------- |
| `NEXT_PUBLIC_SUPABASE_URL`      | Yes           | Yes                 | Project URL                                                     |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Yes           | Yes                 | Publishable key                                                 |
| `ANTHROPIC_API_KEY`             | No            | **No**              | Enables AI authoring                                            |
| `CAPTIVATE_AI_MODEL`            | No            | No                  | Overrides the model id                                          |
| `PEXELS_API_KEY`                | No            | **No**              | Enables the picker's Find tab                                   |
| `OPENAI_API_KEY`                | No            | **No**              | Enables the picker's Generate tab                               |
| `NEXT_PUBLIC_SITE_URL`          | In production | Yes                 | Absolute origin for email links                                 |
| `SUPABASE_SERVICE_ROLE_KEY`     | With billing  | **No**              | The Stripe webhook is the only writer of subscription state     |
| `STRIPE_SECRET_KEY`             | No            | **No**              | Enables billing; absent means nobody is throttled               |
| `STRIPE_WEBHOOK_SECRET`         | With billing  | **No**              | Verifies the webhook; it is that endpoint's only authentication |
| `STRIPE_PRICE_PRO_MONTHLY`      | With billing  | **No**              | Price id for $12/month Captivate Pro                            |
| `STRIPE_PRICE_PRO_ANNUAL`       | With billing  | **No**              | Price id for $96/year Captivate Pro                             |

The image-generation ceilings are deliberately not in this table. All three —
the price of one image, the shared monthly budget, and `daily_max`, the _cap_ on
how many images one author may generate in a day — live in
`public.ai_image_limits` and are read by the reservation itself, because a
ceiling passed in by the caller is a ceiling the caller chooses; see
[SECURITY.md](SECURITY.md). The table holds the cap and nothing else: the count
it is compared against is derived from `public.ai_generations` at reservation
time. Change them with SQL against that row:

```sql
update public.ai_image_limits
   set cost_usd = 0.05, monthly_budget = 100.00, daily_max = 25;
```

**One-time step when applying `0021_reservation_ceilings.sql`.** It seeds that
row with the documented defaults — 0.05, 100.00 and 25 — which are what
`CAPTIVATE_IMAGE_BUDGET_USD` and `CAPTIVATE_IMAGE_DAILY_MAX` fell back to. If
this deployment had set either variable to something else, **run the update
above with those values before or immediately after applying the migration**: a
budget set lower than the default on purpose would otherwise be raised to 100,
and the application no longer reads the variable that said so. It does log
`captivate:failure ai.image.ceilings-moved` for as long as either variable
remains set, so the mismatch is findable rather than silent, but the log is a
safety net and not the fix. Unset both once the row matches.

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
the missing variables, rather than throwing on every request. The three optional
provider keys degrade the same way in miniature: a deployment without
`PEXELS_API_KEY` or `OPENAI_API_KEY` simply does not show that tab in the image
picker, rather than showing one that fails when used.

The three image figures — the price of one image, the shared monthly budget and
the per-author daily cap — are rows in `public.ai_image_limits` rather than
variables, and are read at call time, so changing them takes effect without a
deploy. They bound a real bill — see the reservation section in
[SECURITY.md](SECURITY.md).

---

## Database

Apply the migrations in `supabase/migrations/` **in order**. Either paste them
into the Supabase SQL editor, or run them with the Supabase CLI:

```bash
supabase link --project-ref <ref>
supabase db push
```

| Migration                            | Contents                                                                                                                                                      |
| ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0001_captivate_core.sql`            | Tables, indexes, triggers, and RLS on the core tables                                                                                                         |
| `0002_storage.sql`                   | Three private buckets and their per-user object policies                                                                                                      |
| `0003`–`0004` journey                | World-canvas placement and its defaults                                                                                                                       |
| `0005_movements.sql`                 | `sections.label` — the movement name shown to the audience                                                                                                    |
| `0006_narrative_map.sql`             | `moments`, `sections.purpose`, `scenes.moment_id`                                                                                                             |
| `0007_target_duration.sql`           | `presentations.target_seconds`                                                                                                                                |
| `0008_search_path.sql`               | `search_path` pinned on every function; EXECUTE revoked from client roles on the trigger functions, which Supabase otherwise exposes at `/rest/v1/rpc/<name>` |
| `0009_transcripts.sql`               | `recordings.transcript`                                                                                                                                       |
| `0010_share_links.sql`               | `presentations.share_token` and the one resolver a link-holder may call                                                                                       |
| `0011_shared_assets.sql`             | Asset access for a shared deck, and the storage policy behind it                                                                                              |
| `0012_scene_flow_role.sql`           | `scenes.flow_role`, and `flowRole` in the shared payload                                                                                                      |
| `0013_generation_reservation.sql`    | Reserve-before-spend for AI calls                                                                                                                             |
| `0014_remote_sessions.sql`           | `presentation_sessions` and the phone remote's channel gate                                                                                                   |
| `0015_sourced_visuals.sql`           | Asset provenance, and the image-generation budget                                                                                                             |
| `0016_shared_asset_by_reference.sql` | Resolves a shared deck's images by what the deck references                                                                                                   |
| `0017_billing.sql`                   | `subscriptions`, and the delivered-event table the webhook is idempotent through                                                                              |
| `0018_allowance_accounting.sql`      | Stops charging an allowance for a call that never reached the model                                                                                           |
| `0019_plan_grants.sql`               | A granted plan, checked before a bought one                                                                                                                   |
| `0020_ledger_integrity.sql`          | The spend ledger is not the caller's to rewrite                                                                                                               |
| `0021_reservation_ceilings.sql`      | The image ceilings move into `ai_image_limits`; **not additive — see below**                                                                                  |

Every one is additive except the last: new columns carry defaults and new tables
carry their own policies, so applying them ahead of a deploy is safe and is the
right order.

**`0021` is the exception, and it is not safe to apply ahead of a deploy.** It
drops `captivate_reserve_image_generation(text,uuid,numeric,numeric,integer)` and
creates a two-argument form in its place, because leaving the old signature
callable would close nothing. There is therefore no ordering that avoids a
window: the running application calls the five-argument form until the new build
is live, and the new build calls the two-argument form as soon as it is. Apply
the migration and release the application as one coordinated step, migration
first — that is the order that closes the hole soonest, and the failure either
side of it is a clean refusal saying nothing was spent, not a corrupted row.

**`0014` touches `realtime.messages`, which Supabase owns.** The migration
enables RLS on it only if it is not already enabled, because Supabase enables it
itself and does not make the migration role the table's owner — an unconditional
`ALTER` fails with `must be owner of table messages`. The policies it creates are
what authorise the phone remote's channel; without them that feature does not
work, and the block is skipped entirely where Realtime is not installed.

### Verify it worked

Two different questions, and both need asking.

**Does the isolation hold?**

```bash
# Against a local Postgres, with a Supabase-shaped stub:
PGHOST=/tmp PGPORT=55432 PGUSER=postgres ./supabase/tests/run.sh
```

This creates two users and asserts that neither can read, write, update or
delete the other's presentations, scenes or notes, and that neither can forge
`owner_id`. It exits non-zero on any leak.

**Does the database you are about to serve users from have everything?**

```bash
SUPABASE_DB_URL='postgres://...' npm run migrations:check
```

Run this against the _target_ database, as the last gate before a deploy is
called done. It asks that database directly for every object the application
needs — `supabase/schema_required.sql` — and names the feature each missing one
breaks.

This exists because the same failure has now happened twice, and both times it
read as a code bug rather than a deploy that had not finished:

| what was missing | what users saw                                                       |
| ---------------- | -------------------------------------------------------------------- |
| `0009`–`0014`    | "Couldn't reserve an AI call just now." Every AI call, for everyone. |
| `0015`           | Image generation and stock search would have failed the same way.    |

Nothing else catches it. The build is green, the unit suite is green, and the
RLS suite is green _because_ it applies every migration to a scratch database
first — every check ran against a database that was not the one serving users.

It asserts objects rather than comparing migration filenames, because the
ledger does not record them: Supabase splits `0001` into two rows and `0004`
into two more, and records `0008_search_path` as `captivate_harden_functions`.
Matching those by name produces false alarms, and a check that cries wolf is
worse than no check at all.

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

The canonical Vercel project is already connected and builds a Preview deployment on
every push. Reuse that project and its Preview environments; do not create a second
Vercel project for branch isolation.

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
