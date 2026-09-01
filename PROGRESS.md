# Progress

## Current State

- Product: Captivate
- Lifecycle stage: Beta / production-readiness
- Control-graph node: HOSTED_RUNTIME_VERIFICATION (live app in owner-driven test loop)
- Current milestone: Production readiness — discoverability, the signed-in
  coverage gap, password policy, and a trust surface
- Branch: `claude/premium-ui-presentation-akzjzs` → PR #38, open
- `main`: PRs #22–#37 merged and deployed via Vercel auto-deploy
- Brand: Captivate is the product; Axtevi is the company it sits under
  (`captivate.axtevi.com`). No domain is hardcoded — redirects build from
  `NEXT_PUBLIC_SITE_URL`.
- Production: live and in use at `https://www.axtevi.com`; the owner tests
  deployed builds and reports defects
- Database: canonical Supabase project `qnbwyymwhvqprjtyfdmb`. Migrations
  `0017_billing.sql`, `0018_allowance_accounting.sql`,
  `0019_plan_grants.sql` and `0020_ledger_integrity.sql` are **applied to
  production**, the last verified by querying the function signatures and
  grants back out of it.

## Latest Session

### Production-readiness pass — PR #38

Four launch blockers. Three turned out to be the same shape: something built,
deployed and correct that the only client who mattered could not reach.

**The front door could not be found.** `src/app/layout.tsx` carried
`robots: { index: false, follow: false }` for every route, so the landing page,
pricing and sign-up were invisible to search. Indexing is now per route: the
signed-in application, every link-addressed page and both recovery flows opt out
explicitly. `/v/<token>` matters most — a share link is the author's decision
about who sees a deck, and indexing one revokes it silently.

Adding `robots.ts` and `sitemap.ts` exposed the second half: both are generated
routes, so the proxy matcher's static-asset exclusion does not reach them, and
both were answering an anonymous request with a 307 to `/sign-in`. Confirmed
live on production before the fix. `public-paths.ts` already carried a comment
about this exact failure from when the share link was behind the gate; it had
happened again.

**The signed-in app is now under test.** Two earlier attempts died in the
bundler and the cause was never diagnosed, because the error only appears when
the bundle is run alone: rolldown cannot resolve `server-only`, reached through
a `"use server"` module that vite follows and Next replaces. `build.ts` now
stubs those modules the way Next does, reading export names from the real
source. `server-only` is deliberately not aliased away, so a genuine boundary
violation still fails the build. The editor runs with its real store, autosave,
shortcuts and canvas; removing `dirtySections` from `updateSectionLocal` — the
regression that shipped for a release — fails the tests.

**Password policy** was eight characters and nothing else. Now refuses the
common list, its substitution-folded form, repeated characters, key runs, and a
password that is really the email or display name on the same form. Enforced
server-side in both sign-up and recovery.

**A trust surface.** Privacy and terms pages, written from the code — every
processor named is one the application really contacts. Where the product has no
answer, they say so: account deletion is not self-service.

### Verification

- `npm run verify` green: 990 unit/component tests across 72 files.
- Playwright: 36 smoke, 35 lifecycle, 5 shader.
- `npm run test:rls` green including the reservation race.
- Production re-verified independently: the supersession rule is present in the
  deployed function, `captivate_settle_image_generation` is the five-argument
  form, no spend function is anon-reachable, no owner-scoped table is missing
  RLS, and nothing in `schema_required.sql` is absent. No migration drift.
- `robots.txt`, `sitemap.xml`, per-route `noindex` and the legal pages confirmed
  in rendered output from a built server rather than from source.

## Blockers

- None.

## Standing owner actions

1. Set the Stripe account's public business name to **Axtevi** — it appears on
   card statements, receipts and the Billing Portal.
2. Confirm `STRIPE_WEBHOOK_SECRET` matches the mode of `STRIPE_SECRET_KEY`.
   Test and live endpoints have different secrets, and a mismatch fails every
   delivery while everything else looks correct.
3. Delete the two disposable `webhook-probe@example.com` Stripe customers left
   by the end-to-end proof (tagged `delete_me`).
4. **Enable leaked-password protection** — Supabase dashboard, Auth → Policies.
   It checks new passwords against HaveIBeenPwned and costs nothing. There is no
   MCP tool and no management token in the agent environment, so it cannot be
   set from here. The application-level policy in `src/lib/auth/password.ts`
   narrows the gap but does not replace a breach corpus.
5. **Set `NEXT_PUBLIC_SUPPORT_EMAIL`** in Vercel. Until it is set, the privacy
   and terms pages say to contact whoever runs the deployment rather than print
   an address nobody reads.
6. **Review the privacy and terms wording.** The facts in both are derived from
   the code and are accurate; the wording has had no legal review.

`PEXELS_API_KEY` and `OPENAI_API_KEY` are configured, so cover photographs and
the photo dress pass are live.

## Recommended Next Steps

1. **Account deletion.** Not self-service, and the privacy page says so. Doing
   it properly means cascading through presentations, scenes, assets,
   recordings, storage objects and the Stripe subscription; doing it badly
   leaves orphaned files and a live subscription, which is why it was recorded
   rather than rushed into a release pass.
2. **A hosted authenticated journey.** Signed-in _components_ are covered now;
   a signed-in _session_ against Preview is not. Sign-up requires email
   confirmation, so a synthetic user cannot be created with the anon key alone —
   it needs a dedicated test identity or a service-role key scoped to a test
   project.
3. **`codex/economical-ci-20260831`** carries five unmerged commits that select
   CI checks by changed-file risk. Worth a decision: it trades hosted-CI cost
   against coverage, and that is a judgement about how much protection to keep,
   not a defect to fix.
4. **Stale branches.** Nineteen are fully merged with no unique commits and are
   safe to delete, but this environment's git proxy refuses a delete refspec
   (HTTP 403), so they remain. Enabling "automatically delete head branches" on
   the repository would stop them accumulating.
5. `docs/ROADMAP.md` holds what has been asked for and not built: audience
   feedback (polls, trivia, Q&A), integrations with confidence monitors and
   Descript, keeping a reference file as stored evidence, and PDF reading.
