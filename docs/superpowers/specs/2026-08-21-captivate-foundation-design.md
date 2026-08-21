# Captivate Foundation Design

**Status:** Owner-approved foundation; implementation planning pending owner review of this written specification  
**Date:** 2026-08-21  
**Repository:** `athompson83/captivate`  
**License:** GNU Affero General Public License v3.0 (`AGPL-3.0-only`)

## 1. Product intent

Captivate is an open-source, AI-assisted presentation platform for creating and delivering animated, journey-style presentations. It should feel more like navigating a designed story than advancing through a stack of conventional slides.

The first product must support three distinct working surfaces:

1. **Library:** organize, categorize, search, duplicate, import, and manage presentations and lecture notes.
2. **Editor:** compose sections and views, insert content anywhere, apply themes and animation, manage assets, and edit presenter notes.
3. **Presenter:** deliver a browser-chrome-free audience view while privately controlling navigation, notes, timers, annotations, camera, and recording.

AI accelerates creation and editing but never becomes the authoritative storage format. Presentations remain portable, human-editable documents rendered by deterministic application code.

## 2. Product principles

- **Journey-first:** a presentation is a sequence of spatial or narrative views grouped into sections, not merely a list of fixed slides.
- **Presenter confidence:** the presenter surface must remain private, predictable, recoverable, and independent from the audience surface.
- **Progressive capability:** core text, images, video, audio, shapes, and diagrams work without advanced graphics packages. Rive, charts, and 3D are optional block types.
- **Open and portable:** user content is stored in a versioned, documented schema rather than proprietary library objects.
- **Accessible by construction:** semantic HTML is preferred for content; keyboard navigation, reduced motion, screen-reader structure, captions, and contrast checks are built into the system.
- **Local resilience:** editing should tolerate temporary network interruption and recover unsaved local work.
- **Safe AI:** generated content is schema-validated, provenance-aware, previewed, and explicitly accepted before replacing user work.
- **License clarity:** the repository uses OSI-recognized open-source terms and does not describe source-available dependencies as open source.

## 3. Scope boundaries

### 3.1 Initial product scope

- Account, workspace, and presentation library
- Theme-aware editor with sections and views
- Insert-line control for adding a view anywhere
- Rich text, image, video, audio, shape, chart, embed, and interactive graphic blocks
- Asset upload and reuse
- Editable lecture notes and per-view presenter notes
- AI-assisted outline, view, content, image, theme, and presenter-note generation
- Edit history, autosave, explicit versions, and recovery
- Audience and presenter windows with synchronized navigation
- Fullscreen audience view without application editing chrome
- Laser pointer, transient highlight, persistent drawing, palette, undo, and clear
- Total presentation timer and current-view timer
- Camera and microphone preview
- Recording and export of presentation, audio, and camera composition
- Shareable view-only presentation links with access controls
- Import/export of Captivate's documented JSON package
- Baseline PDF export using the deterministic renderer

### 3.2 Foundation-only capabilities

The data model and package boundaries will accommodate these capabilities, but they are not required for the first usable editor milestone:

- Real-time multi-user editing
- Comments and review workflows
- PowerPoint import/export
- Offline installation as a full desktop application
- Marketplace for themes, blocks, or templates
- Native mobile editing
- Advanced server-side rendering farm
- Organization billing and enterprise identity providers

### 3.3 Explicit non-goals

- Rebuilding Figma, After Effects, or a general-purpose video editor
- Persisting arbitrary executable JavaScript inside presentations
- Making one proprietary canvas or animation library the document format
- Requiring 3D or high-end GPU effects for ordinary presentations
- Allowing AI generation to publish or overwrite work without user review

## 4. Architectural approach

Captivate uses a **DOM/SVG-first renderer with selective Canvas/WebGL layers**.

Semantic content such as headings, paragraphs, lists, images, tables, media, and notes renders as HTML or SVG. React Konva supplies a separate interaction layer for freehand annotations, laser effects, and region highlighting. Rive, Apache ECharts, and React Three Fiber render only inside explicit optional blocks.

This hybrid approach provides:

- better accessibility and text selection than a canvas-only editor;
- responsive layouts instead of fixed-pixel slide assumptions;
- deterministic print and PDF rendering;
- high-performance drawing without converting the whole document to Canvas;
- library independence because stored documents describe intent, not runtime objects.

### 4.1 Repository topology

The repository will use pnpm workspaces and Turborepo with the following initial boundaries:

```text
captivate/
├── apps/
│   ├── web/                    # Next.js product application and APIs
│   └── storybook/              # UI, block, theme, and state catalog
├── packages/
│   ├── presentation-schema/    # Versioned document types, validation, migrations
│   ├── renderer/               # Shared audience/editor rendering primitives
│   ├── editor-core/            # Commands, selection, history, autosave, clipboard
│   ├── presenter/              # Dual-window session, controls, notes, timers
│   ├── recording/              # Capture, composition, encoding, export adapters
│   ├── animation/              # Declarative animation model and runtime adapters
│   ├── collaboration/          # Yjs boundary and provider interfaces
│   ├── ui/                     # Captivate design system and accessible primitives
│   └── config/                 # Shared TypeScript, lint, test, and build config
├── supabase/
│   ├── migrations/             # Reviewed forward-only database migrations
│   └── tests/                  # Database policy and contract tests
├── docs/                       # Product, architecture, contribution, and operations docs
└── .github/                    # CI, templates, dependency policy, and governance
```

Applications may depend on packages. Domain packages must not depend on application code. Optional graphics adapters depend on the stable schema and renderer contracts rather than modifying editor state directly.

### 4.2 Runtime stack

- **Language:** strict TypeScript for product and shared packages; SQL for database migrations and policies.
- **Application:** Next.js 16 with React 19.
- **Styling and primitives:** Tailwind CSS, shadcn/ui patterns, and Radix primitives.
- **Text:** Lexical with custom Captivate nodes and JSON serialization.
- **Animation:** Motion for React as the default interaction and layout engine; GSAP behind an adapter for advanced timelines and scroll choreography.
- **Drag and reorder:** dnd kit with keyboard and pointer sensors.
- **Drawing:** Konva and React Konva in an isolated overlay.
- **Graphics:** SVG by default; Rive for authored interactive vector graphics; Apache ECharts for data visualization; React Three Fiber for optional 3D blocks.
- **Collaboration:** Yjs behind a provider contract, initially persisted through Supabase infrastructure.
- **Recording:** browser `getDisplayMedia`, `getUserMedia`, MediaRecorder, Canvas composition, and WebCodecs when supported; server-side FFmpeg is the compatibility and MP4 finalization path.
- **Platform services:** Supabase Postgres, Auth, Storage, and Realtime; Vercel for the web application and controlled background jobs.
- **Quality:** Vitest, React Testing Library, Playwright, Storybook, axe, schema contract tests, migration tests, and visual regression tests.

Exact dependency versions will be pinned by the implementation plan after compatibility checks. No package is accepted solely because it is popular; its license, maintenance, bundle impact, accessibility, browser support, and replacement cost are recorded in the dependency review.

## 5. Presentation document model

The canonical document is versioned JSON validated at every trust boundary.

```text
Presentation
├── metadata and schemaVersion
├── theme reference and token overrides
├── sections[]
│   └── views[]
│       ├── layout
│       ├── blocks[]
│       ├── transitions
│       ├── animation tracks
│       └── presenter-note reference
├── asset references[]
├── navigation graph
├── accessibility metadata
└── provenance and version metadata
```

A **section** is a narrative grouping. A **view** is a presentable camera state or audience moment and is the unit used by navigation, notes, and the view timer. A view can behave like a conventional slide or reveal another region in a continuous journey.

A **block** uses a discriminated type, stable identifier, layout constraints, semantic content, style tokens, animation bindings, and accessibility metadata. Optional blocks store normalized configuration rather than serialized runtime instances from Konva, GSAP, ECharts, Rive, or Three.js.

All schema changes require:

1. a new schema version;
2. forward migration code;
3. fixture-based compatibility tests;
4. documented behavior for unsupported future documents;
5. preservation of the original document if migration fails.

## 6. Editor architecture

The editor follows a command model. User actions create typed commands that update the canonical document, feed undo/redo history, mark autosave state, and optionally produce collaboration updates.

Primary editor regions:

- **Navigator:** sections, views, search, ordering, and presentation structure.
- **Stage:** deterministic rendering of the current view plus selection affordances.
- **Insert line:** contextual control between views and sections that opens templates, blocks, or AI generation.
- **Inspector:** layout, style, animation, accessibility, and block-specific settings.
- **Notes workspace:** lecture notes and per-view presenter notes with explicit linkage.
- **Asset panel:** uploads, generated images, reusable media, metadata, and usage tracking.

The renderer is shared between editor, audience, export, thumbnail, and recording paths. Editor affordances are overlays and must never alter the underlying audience output.

Autosave uses debounced optimistic updates with revision checks. A failed remote save retains the local change set, visibly marks the document as unsynced, and retries safely. Conflicts never silently replace either version.

## 7. Animation and graphics model

Animation is declarative and bounded. Each track targets a stable block or property, uses a supported trigger, and contains timing, easing, and reduced-motion behavior.

Supported trigger categories are:

- view enter and exit;
- presenter advance and reverse;
- click or explicit presenter cue;
- scroll progress within a journey section;
- media time;
- bounded data or interaction events from an approved block.

Motion for React handles normal transitions and responsive layout changes. The GSAP adapter handles advanced timelines, text sequences, path motion, and scroll-linked choreography. A presentation can be rendered without GSAP-specific objects in its saved document.

Heavy graphics are lazy-loaded per block. The renderer enforces a frame-budget policy, pauses inactive media and animation, honors reduced motion, and supplies a semantic or static fallback for Canvas, Rive, chart, and 3D content.

## 8. Presenter and audience synchronization

Presenter mode creates two security-separated surfaces:

- **Audience window:** fullscreen, minimal, read-only presentation output.
- **Presenter console:** navigation, upcoming view, private notes, timers, camera preview, recording controls, and annotation tools.

Same-browser windows synchronize through a typed session protocol using `BroadcastChannel`, with a guarded fallback transport for unsupported contexts. Each message includes a session identifier, presentation revision, monotonic sequence, and command type. Stale or foreign messages are ignored.

The audience window never receives private notes. It receives only the current public document projection, navigation state, approved annotations, and public media state. Closing either window does not destroy the presentation or recording without an explicit confirmation path.

Fullscreen activation follows browser security requirements and occurs from a user gesture. Captivate cannot remove operating-system chrome or override browser security indicators, but the audience experience uses the Fullscreen API to remove application and ordinary browser navigation chrome where supported.

## 9. Annotation system

Annotations are stored separately from presentation content.

- **Laser:** ephemeral pointer trail with automatic fade; not persisted by default.
- **Highlight:** click-drag region or text emphasis with configurable persistence.
- **Pen:** vector strokes with a small accessible color palette and width selection.
- **Controls:** undo last mark, clear current view, and clear session.

The audience receives only the normalized annotation projection. Presenter pointer coordinates are transformed into view-relative coordinates, keeping marks aligned across different screen sizes. Annotation history can be embedded in a recording but does not modify the source presentation unless the user explicitly converts a mark into content.

## 10. Recording and export

Recording is a state machine with explicit permission, readiness, active, paused, finalizing, completed, recoverable-failure, and unrecoverable-failure states.

The browser captures the audience presentation surface, microphone, and optional camera. An off-screen composition pipeline places the camera in a user-selected layout that is visible in the exported recording but not forced onto the live audience view. Recording chunks are checkpointed to prevent a late encoding failure from discarding the entire session.

Export priority is:

1. browser-native WebM recording that can be recovered immediately;
2. WebCodecs-assisted encoding when capability checks pass;
3. server-side FFmpeg composition or MP4 finalization;
4. preservation and download of the recoverable WebM if final conversion fails.

The UI must distinguish recording from finalization and upload. Navigation remains usable if the export worker is delayed. The system never reports success until the final artifact is readable and its metadata is stored.

## 11. AI architecture

AI is connected through provider-neutral server interfaces. Provider credentials never reach the browser.

AI operations accept explicit context and return schema-constrained proposals for:

- presentation outlines;
- sections and views;
- block content;
- themes and layout suggestions;
- image-generation prompts and selected assets;
- presenter notes and lecture-note transformations;
- accessibility descriptions and content checks.

Generated output enters a review state. The user can accept, edit, regenerate, or reject it. Existing work is versioned before replacement. Source attachments are referenced by durable asset identifiers, and the application distinguishes user-provided facts from model-generated assertions.

AI calls use authenticated server routes, bounded input and output, rate limits, cost controls, structured audit metadata, content-safety controls, timeouts, and cancellable jobs. Raw secrets, private presenter notes, and unrelated workspace content are excluded unless the user explicitly selects them as context.

## 12. Data and security model

Supabase provides authenticated persistence under row-level security. Principal entities are workspaces, memberships, presentations, presentation revisions, assets, notes, share links, recording sessions, exports, AI jobs, and audit events.

Security invariants:

- Every tenant-owned table has row-level security with deny-by-default policies.
- Service-role credentials are server-only and never used to bypass authorization for ordinary user requests.
- Asset access is scoped through private storage and short-lived signed access where appropriate.
- Share links are revocable, scoped, rate-limited, and store hashed secrets rather than reusable plaintext tokens.
- Uploaded content is type-, size-, and extension-validated; active content is isolated or rejected.
- Presentation documents cannot execute arbitrary stored scripts.
- AI and media jobs are idempotent and have explicit ownership and spending limits.
- Security-relevant state changes produce durable audit events without storing sensitive content unnecessarily.
- Preview and production environments use separate credentials, storage boundaries, callback allowlists, and database targets.

## 13. Accessibility and responsive behavior

The initial quality target is WCAG 2.2 AA for authoring and playback surfaces.

- All core editor actions have keyboard paths.
- Drag-and-drop has keyboard alternatives and announcements.
- Focus is visible and intentionally managed across panels and dialogs.
- Themes expose contrast validation and safe defaults.
- Presentations support semantic reading order independent of visual position.
- Images and non-text blocks support alternative descriptions.
- Video supports captions and transcripts.
- Animation has reduced-motion behavior and avoids unavoidable flashing.
- Audience views scale from laptop projectors through large displays without changing the canonical document.
- Presenter controls remain usable on a second laptop display or tablet-sized window.

## 14. Error handling and recovery

Errors are classified by user impact and recovery path:

- **Validation:** reject malformed input while retaining the last valid document.
- **Local editing:** keep the command and recovery snapshot if remote persistence fails.
- **Version conflict:** preserve both revisions and present an explicit resolution flow.
- **Media:** show a stable fallback without blocking unrelated presentation content.
- **Presenter sync:** retain independent local navigation state and offer reconnection without exposing notes.
- **Recording:** preserve checkpointed chunks and expose the best recoverable output.
- **AI:** fail without changing source content; retain the request metadata needed for a safe retry.
- **Export:** keep the source presentation and any completed intermediate artifact.

User-facing errors state what failed, what remains safe, and the next available action. Operational logs use correlation identifiers and exclude secrets or unnecessary presentation content.

## 15. Testing and release gates

Every merge candidate must pass the relevant subset of these gates:

- formatting, lint, strict type checking, and dependency/license review;
- unit tests for schema, commands, transforms, timers, and state machines;
- contract tests for document migrations and renderer parity;
- component tests for editor controls and accessibility semantics;
- database tests for migrations, constraints, and row-level security;
- Playwright flows for create, edit, autosave, recover, present, annotate, record, export, and share;
- visual regression tests for themes, core block types, viewport sizes, and reduced motion;
- browser compatibility checks for current stable Chromium, Firefox, and Safari;
- performance budgets for editor interaction, presentation frame rate, bundle size, and memory growth;
- security checks for secrets, dependencies, authorization boundaries, uploads, and stored content;
- exact-commit Preview deployment verification before a Production release.

A feature is not complete if only its happy path works. Recovery, accessibility, authorization, and observability are part of the acceptance criteria.

## 16. Open-source governance and licensing

The codebase will use `AGPL-3.0-only`. This permits use, modification, sharing, and commercial operation while requiring operators of modified network-accessible versions to offer corresponding source to their users.

The license protects copyrightable implementation, not the product idea, workflow concept, name, or market position. Additional protection comes from execution, the Captivate trademark policy, trusted hosted services, and a healthy contributor community.

Repository governance will include:

- `LICENSE` containing the unmodified AGPL-3.0 text;
- `CONTRIBUTING.md` with technical and review expectations;
- a Contributor License Agreement that lets contributors retain copyright while granting the project a perpetual right to use, modify, distribute, and relicense accepted contributions;
- `CODE_OF_CONDUCT.md`;
- `SECURITY.md` with private vulnerability reporting instructions;
- a trademark policy that reserves the Captivate name and official branding without restricting lawful code forks;
- dependency license inventory and automated checks.

Any future commercial dual-license offering must be legally reviewed and may use only code for which the project has sufficient relicensing rights. This design is not legal advice; final legal documents should be reviewed by qualified counsel before commercial reliance.

## 17. Delivery sequence

Implementation planning will decompose the work into independently verifiable milestones in this order:

1. repository governance, CI, monorepo, and shared quality configuration;
2. versioned presentation schema and deterministic renderer;
3. library, authentication, persistence, and asset foundations;
4. editor command system, navigation, blocks, themes, and notes;
5. animation model and journey navigation;
6. presenter/audience dual-window session, notes, and timers;
7. annotations and pointer tools;
8. recording, recovery, and export;
9. AI proposal workflow and generation adapters;
10. share links, hardening, accessibility certification, and beta release;
11. collaboration implementation after the single-user editing and recovery model is stable.

This order prevents collaborative state, AI output, or media export from becoming the foundation of an unstable document model.

## 18. Acceptance of the foundation

The foundation is ready for implementation planning when:

- the owner accepts this document as the governing architecture;
- the implementation plan maps milestones to exact files, tests, and verification commands;
- dependency choices are checked for compatible versions and licenses during scaffolding;
- no implementation treats an optional vendor package as the canonical document format;
- the first milestone can produce a deterministic presentation fixture in editor, audience, thumbnail, print, and test contexts.
