<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Captivate — shared agent entry point

## Context and authority

- Captivate is an AI-native presentation, lecture, and recording tool. Read `docs/ARCHITECTURE.md` and `docs/FILE_STRUCTURE.md` for the relevant architecture and files; do not impose another app's scaffold.
- `APP_PROJECT_CONTROL_STANDARD.md` remains canonical. At material-session startup reconcile it, this file, `PROJECT_CHECKLIST.md`, and current `PROGRESS.md` with primary GitHub/runtime/test evidence.
- The previous technical manual is preserved unchanged in `docs/agents/operating-reference-2026-09-10.md`; its applicable technical/visual/security requirements remain mandatory. All paths inside it are repository-root-relative. Read relevant sections on demand, not as an automatic full import.
- Current owner instructions and the canonical standard govern pre-shipping delivery and owner-only boundaries. This index does not grant platform permissions or remove release controls.
- Check directory-scoped instructions. Use existing plans and one end-to-end acceptance milestone with explicit non-goals; do not add a competing constitution or roadmap.

## Non-negotiable technical and product rules

- Preserve movement/moment/scene terminology, one shared renderer, normalized 0–100 stage geometry, semantic design tokens, and the world-canvas distinction between bare regions and card-mode previews.
- Camera animation writes through refs/promoted transforms, not React renders on every frame; preserve endpoint-based culling and lifecycle guarantees.
- `use server` files export only async functions. Secret-touching modules import `server-only`. Keep shared constants in plain modules.
- Validate every boundary, including model/database content and cross-window messages. Preserve schema-level URL protocol protection and the established action-result error union.
- All editable changes and undo must mark the appropriate dirty state and survive reload. Narrative-map replacement is whole-document, never a partial payload that silently deletes omitted moments.
- Preserve Zod 4 defaults, Supabase row-type conventions, React Compiler rules without blanket disables, and stable Zustand selectors (`useShallow` for new arrays/objects).
- Audience routes never load private notes; preserve field-by-field `forAudience` construction and the stricter phone-remote import boundary. Presenter-facing controls are not permission to load private notes.
- Analysis scores must reflect measured checks, label estimates, give actionable findings, and preserve the actual contrast calculation rather than a look-alike metric.
- Migrations are append-only. Preserve owner-scoped RLS, pinned search paths, private buckets/signed URLs, and policies in the same change as tables.
- Never ship controls that merely look functional, allow unvalidated model output into a document, commit credentials, or document behavior the code does not provide.

## Existing verification, not ceremonial scripts

- Existing commands: `npm run dev`, `npm run verify`, `npm run test`, `npm run test:e2e`, and `npm run test:rls`. Verify is the established format/type/lint/unit/build gate; preserve it before claiming completed work.
- Reconcile committed lockfile and compatible runtime/package-manager versions across local agents, CI, and hosting. Use the ecosystem's frozen install; never introduce fake setup/doctor/smoke commands or silently regenerate dependencies.
- Run focused local tests while iterating, then the required applicable gate. Fixes need regression tests that fail without the fix; verify intentional failure propagation when changing the harness.
- Server-free Playwright `shader` and `lifecycle` projects provide browser coverage without accounts. Use them where applicable; do not label software/fixture rendering as physical-GPU or real-provider evidence.
- Full E2E and RLS checks need documented non-Production services. Ordinary development uses synthetic data and no Production credentials/paid-provider calls; keep authorized live tests separate.
- For a presentation change, acceptance should exercise authoring, save/reload, actual presentation/remote behavior, and relevant export/recording paths—not merely prove an isolated renderer function exists.
- Record exact SHA, commands, results, environment, browser/visual artifacts, and remaining limitations. File presence and unit tests alone do not prove runtime wiring or visual quality.

## Economical CI and controlled delivery

- Diagnose full failing logs before reruns. Avoid speculative pushes, duplicate workflows, unnecessary matrices/artifacts, and unrelated database or deployment checks.
- Agent policy, release policy, dependencies, toolchain, workflows, auth/schema/contracts, and executable Markdown require impact-aware validation; ordinary prose-only changes need an explicit allowlist.
- When altering routing, keep required workflows observable and test an always-evaluated final gate that rejects failed, cancelled, or missing required work. Cost reduction must not weaken meaningful gates.
- Cancel superseded PR validation where safe, not blindly Production deployments/migrations. Preserve least-privilege tokens, immutable action references, and untrusted/privileged separation.
- Reuse canonical hosting/database projects and appropriate branches/previews. Before merging, check actual deployment triggers and release authorization because a merge may deploy Production.
- Fix relevant blockers and invariant violations now; record unrelated cleanup without expanding the milestone. Do not modify an exact-SHA certification candidate without restarting its evidence.

## Handoff and compact memory

- Distinguish implemented, wired, locally verified, hosted verified, and released. Never promote a state because an earlier state passed; label mocks and unrun checks explicitly.
- Update existing `PROJECT_CHECKLIST.md` and concise `PROGRESS.md` near closeout. Preserve evidence when archiving history; do not copy session transcripts into startup instructions.
- Report genuine owner actions, blockers, and the next smallest task. Use existing skills selectively, one implementer and separate review by default, and isolated resources for independent parallel work.
- Confirm intended guidance and command discovery in fresh Codex/Claude sessions. `CLAUDE.md` already imports `AGENTS.md`; do not duplicate its instructions.

Policy-only adoption evidence: `docs/agent-foundation-review.md`.
