# Progress

## Current State

- Product: Captivate
- Lifecycle stage: Beta / production-readiness
- Control-graph node: HOSTED_RUNTIME_VERIFICATION (live app in owner-driven test loop)
- Current milestone: Close the AI spend ledger against the caller who is
  billed by it
- Branch: `claude/premium-ui-presentation-akzjzs` → PR #35, merged
- `main`: PRs #22–#35 merged and deployed via Vercel auto-deploy
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

### Shipped to `main` and to production — PR #35, "Stop a caller settling their own AI spend in their own favour"

The two functions that record what an AI call cost run with the _author's own_
JWT, because that is the client a route handler already holds. Nothing on the
wire tells them apart from the same RPC issued straight from a browser, and
`ai_generations` is selectable by its owner, so a pending reservation's id is
one query away. That made two accounting refinements into ways of spending
nothing:

- `0018` stopped charging for a call that never reached the model, keyed on
  `failed` with no output tokens. An author could settle their own in-flight
  reservation into exactly that state, keep the answer the server was already
  generating, and repeat. Ten decks a month became unbounded.
- An image settlement could write any `cost_usd`. Zero released the shared
  monthly budget; a large one exhausted it for everybody. The application only
  ever echoed back the estimate it had already reserved.

Each link was confirmed against the production schema before anything changed:
the `authenticated` EXECUTE grants, the owner-select policy, and the counting
predicate.

`0020` answers it with ordering rather than identity. No check inside those
functions can separate the server from the author — they hold the same
credential — but the server settles _after_ the model replies. So a row is
rewritable exactly while it is not counting against anybody, and final in every
state that counts: the only settlement a later call can overwrite is the one
claiming nothing was owed. Image settlement no longer carries a price at all.

The first attempt at that rule was keyed on "recorded no spend", which was too
wide: an `invalid_output` with no usage records no spend and still counts, so
that row stayed rewritable after the server had written the truth and the
refund could be forged a second time. Caught by re-reading the predicate
adversarially, and closed before merge.

Also revoked the `anon` EXECUTE grant Supabase adds by default to the five
spend functions and to the phone remote's channel gate. `revoke ... from
public` never took that grant back, which is why `remote_gate_closed_to_anon`
had been asserting a property production did not have. The test stub now models
Supabase's default privileges, so the harness and the deployment agree.

### Verification

- `npm run verify` green: 962 unit/component tests across 70 files, typecheck,
  lint and build clean.
- `npm run test:rls` green against a real Postgres, including thirteen new
  `ledger_*` probes. Four of them were watched failing against `0019` first:
  the forgery accepted, the server's truthful write rejected, the allowance
  freed, and — for the tightened rule — the second forgery succeeding.
- `migrations:check` green. It caught the real defect in this change: the
  image-settle signature changed and `supabase/schema_required.sql` still named
  the old one, which the file itself says is as breaking as an absence.
- Production verified after applying `0020`: the supersession rule is present
  in the deployed function body, the settle function is the five-argument form,
  and `anon` holds EXECUTE on none of the six — while the share-link functions
  still have it. Supabase's security advisor went from nine anon-callable
  `SECURITY DEFINER` functions to three, all of them share-link.
- Accessibility: `axe-core` at WCAG 2.1 A/AA reports zero violations on `/`,
  `/pricing`, `/sign-in`, `/sign-up`, `/reset-password` and `/update-password`
  at 1512×950 and 390×844, and on the shared-deck viewer. The harness was
  proved to catch real faults first, by injecting an unlabelled image and a
  nameless button. Theme contrast is _not_ covered by that run — axe cannot
  resolve gradient backgrounds and returns "incomplete", so the measured theme
  guard remains the only evidence there.

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

`PEXELS_API_KEY` and `OPENAI_API_KEY` are configured, so cover photographs and
the photo dress pass are live.

## Recommended Next Steps

1. Decide on leaked-password protection. Supabase's advisor reports it
   disabled; enabling it checks new passwords against HaveIBeenPwned and costs
   nothing. It is an Auth setting, not a migration, so it needs the dashboard.
2. Decide whether the site should stay unlisted. `src/app/layout.tsx` sets
   `robots: { index: false, follow: false }` for every route, so the front door
   built in PR #33 is invisible to search.
3. The signed-in app — dashboard, editor, presenter console — has still never
   been audited from a browser, because no session in this environment has
   credentials for it. An attempt to mount the editor in the fixture harness
   failed in the bundler on the `"use server"` modules. Either test credentials
   or a shim for those modules would unblock it.
4. `docs/ROADMAP.md` holds what has been asked for and not built: audience
   feedback (polls, trivia, Q&A), integrations with confidence monitors and
   Descript, keeping a reference file as stored evidence, and PDF reading.
