# Implementation Roadmap

## Phase 0 — Foundation

- Repository/documentation contract.
- Next.js/TypeScript/Tailwind/Motion scaffold.
- CI gates.
- Environment validation.
- Supabase schema design and migrations.
- Authentication shell and protected application layout.

## Phase 1 — Library + core authoring

- Presentation CRUD, search, collections, and trash.
- Scene CRUD/reorder/sections.
- Core content blocks and responsive layout system.
- Autosave, undo/redo, and version snapshots.
- Theme tokens and initial professionally designed themes.
- Speaker notes and lecture notes.

**Exit criterion:** a user can build and persist a compelling presentation manually without AI.

## Phase 2 — Presentation engine

- Audience renderer isolated from editor.
- Scene navigation and reveal timeline.
- Motion presets plus advanced choreography primitives.
- Presenter window and audience synchronization.
- Notes, current/next preview, timers, jump navigation.

**Exit criterion:** reliable full-screen presentation from a second display with no private UI leakage.

## Phase 3 — Presenter tools

- Laser pointer.
- Spotlight.
- Drag highlight.
- Freehand annotation + erase/undo/clear.
- Black/pause screen.
- Keyboard/remote navigation and accessibility polish.

## Phase 4 — AI authoring

- Outline generation.
- Scene drafting and local regeneration.
- Speaker/lecture note assistance.
- Source-grounded workflows.
- Asset/image/diagram assistance.
- Theme/layout recommendations.

AI must operate through structured edits to the same authoring model used by humans.

## Phase 5 — Recording/export

- Device preflight.
- Microphone/camera capture.
- Audience-output capture.
- Durable chunks/finalization workflow.
- Video layout and export.
- Recovery/failure handling.

## Phase 6 — Collaboration/import/ecosystem

- Comments and collaboration.
- Public sharing/analytics.
- PPTX/PDF import refinement.
- LMS/embed integrations.
- Live audience participation.
- Remote/co-presenter workflows.

## Release discipline

Do not delay testing presenter reliability until the end. Audience separation, state synchronization, autosave, and recording should gain automated browser tests as soon as each capability is introduced.
