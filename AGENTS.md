# Agent Operating Guide

## Start here

Read `README.md`, `CLAUDE.md`, and the relevant `docs/` files before implementation. Treat those files as the product contract unless a newer user instruction overrides them.

## Working method

- Inspect before editing.
- Prefer the smallest coherent change that advances the current milestone.
- Preserve unrelated work.
- Do not silently change product terminology or architectural boundaries.
- Document durable decisions in `docs/DECISIONS.md`.
- Update feature/architecture docs when implementation materially changes the contract.
- Keep mockups and generated concepts labeled as exploratory unless explicitly approved as final.

## Quality gates

At minimum, substantial changes should pass lint, typecheck, build, and relevant tests. Presenter/audience synchronization, recording, export, authentication, and persistence require explicit failure-state testing.

## Security

- No secrets in commits.
- No Supabase service-role key in client bundles.
- RLS policies accompany user-owned tables.
- Validate file types, sizes, ownership, and signed access for uploaded media.
- Treat imported presentation/document content as untrusted input.
- Sanitize rich text and generated HTML.

## UX

Every feature must work across three mental contexts: authoring, presenting, and audience consumption. Do not let authoring convenience create presenter fragility.
