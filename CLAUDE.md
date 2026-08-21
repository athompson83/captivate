# Claude Implementation Contract

You are implementing **Captivate**, a web-native presentation platform. Read this file, `README.md`, and the files in `docs/` before changing architecture or UI.

## North star

Do not build a PowerPoint clone in a browser. Build a modern presentation authoring and delivery system where a presentation is a responsive sequence of scenes/sections that can animate, zoom, reveal, scroll, branch, and contain interactive media.

## Priority order

1. Product correctness and presenter reliability.
2. Exceptional UX and visual quality.
3. Performance and accessibility.
4. Maintainable architecture and testability.
5. Fast implementation.

## UI rule

Existing mockups, screenshots, and wireframes are **concept references only**. Preserve the intent and information architecture, not their literal composition. The final UI should be materially more refined, cohesive, responsive, and delightful.

Avoid generic AI-dashboard aesthetics, excessive cards, gratuitous gradients, cramped control bars, and decorative animation. Motion must communicate hierarchy, progression, focus, causality, or spatial continuity.

## Core domain model

Use these concepts consistently:

- `Presentation`: top-level authored experience.
- `Scene`: primary navigable unit presented to the audience. A scene is not necessarily a fixed 16:9 slide.
- `Block`: content element within a scene.
- `Timeline`: ordered scene/block animation and reveal events.
- `SpeakerNote`: private content linked to a scene or beat.
- `LectureNote`: longer-form authored notes stored with the presentation and independently searchable/editable.
- `PresenterSession`: live delivery state including current scene, timers, annotations, pointer mode, and audience window.
- `RecordingSession`: media capture state and export metadata.
- `Asset`: reusable image, video, audio, document, icon, diagram, or generated media.

## Critical architectural boundary

Presenter UI and audience UI are separate surfaces. Private notes, presenter timers, controls, mouse cursor tooling, camera previews, and administrative UI must not appear in the audience surface or exported output unless explicitly enabled.

Do not fake this separation with CSS hiding inside one shared rendered tree. Treat audience rendering as an independent presentation surface/window with an explicit synchronized state contract.

## Implementation expectations

- TypeScript strict mode.
- Server Components by default; use Client Components only where browser interaction requires them.
- Feature/domain folders over giant generic component folders as the application grows.
- Schema validation at external and server boundaries.
- Supabase Row Level Security is mandatory before multi-user data is considered safe.
- Never expose service-role credentials to the client.
- Prefer progressive enhancement and browser APIs before heavy dependencies.
- Design keyboard shortcuts intentionally and prevent collisions with browser/OS conventions.
- Respect `prefers-reduced-motion` and provide non-motion equivalents.
- Every important empty/loading/error state should be designed, not accidental.

## Animation guidance

Use Motion for React as the default orchestration layer. Favor transform/opacity and browser-native View Transitions where they improve continuity. Avoid layout-thrashing animation and expensive continuous effects.

Motion language should eventually include:

- scene enter/exit choreography;
- shared-element transitions;
- camera-like pan/zoom between spatial regions;
- staged reveals;
- focus/spotlight transitions;
- scroll-linked narrative beats where appropriate;
- template-specific transition presets with an escape hatch for advanced authors.

## AI guidance

AI is an authoring assistant, not an opaque presentation generator. Generated outputs should preserve structured provenance and be editable at block/scene level. Keep AI providers behind server-side adapters so models can change without rewriting product logic.

AI workflows should support: outline → scene plan → draft content → asset suggestions/generation → speaker notes → revisions. Never force a full-deck regeneration for a local edit.

## Before merging substantial work

Run:

```bash
npm run verify
```

Add or update tests for domain/state logic as it is introduced. For presenter mode, recording, and audience synchronization, browser-level tests are required before production readiness.
