# Progress

## Current State

- Product: Captivate
- Lifecycle stage: Beta / production-readiness
- Control-graph node: HOSTED_RUNTIME_VERIFICATION (live app in owner-driven test loop)
- Current milestone: Production readiness — discoverability, the signed-in
  coverage gap, password policy, and a trust surface
- Branch: `claude/premium-ui-presentation-akzjzs` → PR #44, merged; branch is
  at `main`
- `main`: PRs #22–#44 merged and deployed via Vercel auto-deploy
- Brand: Captivate is the product; Axtevi is the company it sits under
  (`captivate.axtevi.com`). No domain is hardcoded — redirects build from
  `NEXT_PUBLIC_SITE_URL`.
- Production: live and in use at `https://www.axtevi.com`; the owner tests
  deployed builds and reports defects
- Database: canonical Supabase project `qnbwyymwhvqprjtyfdmb`. Migrations
  `0017_billing.sql`, `0018_allowance_accounting.sql`,
  `0019_plan_grants.sql`, `0020_ledger_integrity.sql` and
  `0021_reservation_ceilings.sql` are **applied to production**, the last two
  verified by querying the function signatures and grants back out of it.

## Latest Session

### Owner-reported defects — PRs #43 and #44

Two rounds from the owner's own use of the deployed build, both root-caused
against production data rather than reasoned about from the code.

**Ten of twenty-one scenes in a generated deck were blank** (#44). The model
had written them; `composeScene` discarded them. `layoutFor` chooses each
scene's layout from its moment's visual intent and the model never sees that
choice, so a layout renders the fields it has slots for and drops the rest in
silence. Nine of the ten were `statement` layouts whose **title** was the
statement — a field no layout draws — which is why the navigator read
perfectly while the canvas was empty. Composition is compose-then-rescue now:
the layout draws what it draws, and only when that comes to nothing does it
reach for a heading it was not given, then fall back to a layout that can hold
what is left. A scene given nothing still composes to nothing, so an empty
scene means the author wrote nothing. The scene prompt also states which
fields each layout draws, which it never had.

**Every dashboard thumbnail could blank at once** (#43). The preview query
discarded its error, so a single post-sign-in 401 — the race `listPresentations`
already documents — served an empty map for the whole page. It retries and
logs now, and a salvaged scene says so.

**The editor was unusable below `md`** (#43, #44). Panels took 484px of width
from a 390px viewport; an anchored popover started at −44px at 320px with
`Undo` entirely off-screen. Both fixed and measured, with a fixture that mounts
the real `Popover` against each window edge.

**PowerPoint export dropped a list's style** (#44) — size, alignment, caps,
weight — while honouring all of it for the paragraph beside it, and flattened
each bullet's runs so a bold word arrived plain.

**The interface wears the mark's colours** (#44): accent is the logo's indigo,
`ai` its magenta, the front door's key light its coral, and `--brand-gradient`
carries the whole sweep. The header names the company — Captivate by Axtevi.
Fixed by accident on the way: the dark theme's `warning` and its accent were
three degrees apart at identical lightness.

Seven review findings came back on #44 from Codex and CodeRabbit; all seven
were real and three were defects introduced by the fix itself. 126 tests added
across the two PRs, each checked by reverting the fix it is about.

Not closed, and not mine to close: most generated scenes want a photograph and
this deployment has no `PEXELS_API_KEY` (free) and no `OPENAI_API_KEY` (paid).
Production has issued **zero** image generations, ever.

### Production-readiness pass — PRs #38–#42

#### PR #38 — discoverability, the signed-in gap, the sign-in outage

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

**Signing in produced "This page didn't load."** Reported from production while
this pass was open, and root-caused from the edge log rather than guessed at:
`/home` runs four reads concurrently, exactly one came back 401, and there was
no second request for it anywhere. `readTwice` had been retrying the whole time
without making a request — the builder was constructed outside the closure, and
a PostgREST builder is a one-shot thenable, so re-awaiting the settled one
replayed the cached 401. The function's own comment said it took a closure
"because re-awaiting the same object is not a fresh request", and its call site
did exactly that. The query now builds inside the closure, and `readTwice`
compares references and refuses rather than pretending it tried. The test that
was supposed to cover this passed against the defect, because its fake asserted
the opposite semantics in a comment and then behaved that way; it now counts
builders rather than awaits.

**Password policy** was eight characters and nothing else. Now refuses the
common list, its substitution-folded form, repeated characters, key runs, and a
password that is really the email or display name on the same form. Enforced
server-side in both sign-up and recovery.

**A trust surface.** Privacy and terms pages, written from the code — every
processor named is one the application really contacts. Where the product has no
answer, they say so: account deletion is not self-service.

**What review then found**, all of it real against the code and all fixed: the
privacy page claimed Captivate "never sees" a password (the server actions
receive it to check the policy; they do not store it) and described a handout as
a revocable share link (it requires the owner's account and has no token); the
root layout's canonical was inherited by every indexable page, telling a crawler
`/pricing` duplicates the landing page; `robots.txt` disallowed `/settings/` but
not `/settings`; a missing `NEXT_PUBLIC_SITE_URL` would have published
`localhost` URLs into build-time robots and sitemap files; recovery called the
password policy without identity context, so both identity checks silently did
nothing; and `qwertyuiop` cleared the ten-character minimum because a code-point
comparison cannot see a keyboard row. CI then caught the last of it — the smoke
test still demanded the form promise the old eight-character minimum.

#### PR #39 — the account-deletion decision, recorded rather than implied

#### PR #40 — say something when a failure is handled rather than thrown

Captivate returns failures as values, which is right for the caller and
invisible to everyone else. The whole of `src/` held **one** `console.error`
against 77 handled failure sites. That is not theoretical: the sign-in outage
above had to be root-caused from Supabase's edge log, because the application
recorded nothing about the read that failed.

`src/lib/observability.ts` — one function, a greppable prefix, stderr — wired at
three choke points: `fail()` in `data/actions.ts`, `spend()` in `ai/service.ts`,
and the Stripe webhook, including the case that costs real money in silence, a
completed checkout that cannot be attached to an account.

Four review findings, all four real, **three of them mine** — including one I
introduced while fixing another. The public bad-signature path was logging
unbounded (it is now sampled); a double `detailOf` truncated the suppressed
count away, and my test passed only because it used a short string;
`slice(0, 300) + '…'` is 301 characters and my test asserted `≤ 301`, encoding
the off-by-one; and my own round-2 refactor moved `detailOf` outside the guard,
so a malformed error would have thrown from the logger.

#### PR #41 — keep a keyboard inside a modal

`Dialog` trapped Tab by wrapping at either end, which misses the case a person
actually produces: clicking a dialog's own prose leaves focus on `body`, both
branches fall through, and the browser resumes from the clicked node — out of
the panel and into the page the modal covers. Which direction leaks depends on
the layout, and both ship: prose above the last control leaks via Shift+Tab
(`ConfirmDialog`, rename, template), below it via Tab (`ShortcutsDialog`, the
share dialog, the recording detail dialog).

`data-autofocus` had also never worked. Asked for alongside its fallbacks in one
selector list, `querySelector` returns document order, which is always the
header close button — so `ConfirmDialog`'s documented guarantee never to focus
the destructive action held only because the close button is not it.

**The first version of these tests passed against the unfixed code.** They drove
"focus on nothing" with `blur()`, and Chromium resumes from the sequential focus
navigation starting point — which a click moves to the clicked node and a
`blur()` leaves on the element that had focus. The sabotage run caught it; the
tests now click. Review then found that redirecting a Tab to a _chosen_ target
can strand the keyboard on `body` if that target is disabled or unrendered,
which is worse than the escape; both lookups now filter for controls that can
actually take focus.

#### PR #42 — the reserved price is not the caller's to name

A signed-in user could disable AI image generation for every other user of the
deployment with one request. `captivate_reserve_image_generation` took the
per-image estimate, the monthly budget and the daily cap as arguments on a
function `authenticated` can execute, and the monthly sum has no owner filter
because the ceiling belongs to the deployment. So `p_estimate_usd: 500` wrote
500 into a budget shared by everybody and refused everyone else for the rest of
the month — no model call, no real money, and a free account could do it,
because the Pro gate is applied in the application rather than in the function.

`0020` had closed the settlement end of exactly this threat; this closes the
reservation end, which was the cheaper attack. It was never used: production
holds **zero** `ai_generations` rows of kind `image` — not this month, not
ever — so the shared budget is untouched, there is no poisoned `cost_usd` row
to reverse, and the migration lands on an empty ledger. Checked rather than
assumed, because "nobody exploited it" is the kind of claim that is worth a
query. The three numbers move into
`public.ai_image_limits`, RLS on with no policies, read inside the locked
statement that checks them.

The RLS harness caught two things review would not have: Supabase's default
privileges re-granted `anon` EXECUTE on the recreated function, and an existing
probe asserting `count(*) = 0` was passing only because Bob owned no rows.

Ten review findings were raised on this PR and every one of them was real;
three were about claims rather than code, which is the failure this session
kept repeating. The last of them is worth recording because it changed
the fix rather than the prose: the ceilings were read *before* the budget lock
was taken, so a queue of callers each held the numbers from before an operator
lowered them and was then admitted one at a time against a budget that no
longer existed — the lock guarding the measurement while leaving the decision
unguarded. `supabase/tests/ceiling_race.sh` holds eight callers inside the
function while the budget is lowered to zero and asserts all eight are refused;
against the previous ordering it reports `tickets_issued=8`. The documented
operator update in `docs/DEPLOYMENT.md` now takes the same lock, so the
boundary holds from the writer's side too.

### Verification

- `npm run verify` green with no warnings: **1023 unit/component tests across 74
  files**.
- Playwright: 37 smoke, 41 lifecycle, 5 shader.
- `migrations:check` against a database with every migration applied: all 36
  required objects present, including `public.ai_image_limits` and the new
  two-argument signature.
- `npm run test:rls` green including both concurrency harnesses — the
  reservation race and the new ceiling race — and all 13 `image_*` probes. Both
  were re-run against the defect they describe and both fail there.
- Production re-verified independently: the supersession rule is present in the
  deployed function, `captivate_settle_image_generation` is the five-argument
  form, no spend function is anon-reachable, no owner-scoped table is missing
  RLS, and nothing in `schema_required.sql` is absent. No migration drift.
- `robots.txt`, `sitemap.xml`, per-route `noindex`, all six canonicals and the
  legal pages confirmed in rendered output from a built server rather than from
  source — including a build made with `NEXT_PUBLIC_SITE_URL` cleared and only
  Vercel's production URL set, to prove that fallback survives static
  prerendering.
- Every new assertion was run against its own defect before being trusted: the
  retry test fails three of five cases, the recovery test two of three,
  `qwertyuiop` is accepted, and the robots, canonical and origin tests each
  fail.

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
2. **A hosted authenticated journey — and it does not need the owner.**
   Signed-in _components_ are covered; a signed-in _session_ is not. Both routes
   out of this environment are closed, and that was established rather than
   assumed: production `mailer_autoconfirm` is `false`, so a synthetic sign-up
   needs a mailbox nothing here can read, and there is no Docker daemon in the
   agent container for a local Supabase stack. Neither is an owner decision. The
   route that needs no credentials at all is a CI job that runs the Supabase
   stack locally in GitHub Actions — where Docker does exist — seeds a confirmed
   synthetic user, and runs the `authenticated` Playwright project against it.
   That is engineering work rather than an owner action, and it closes the
   signed-in-*session* gap. It does not close BETA-001 as written, which asks
   for authenticated journeys against the exact hosted Preview candidate — a
   local stack is a different environment, and calling it the same thing is how
   a gate gets marked done without the evidence it names.
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
