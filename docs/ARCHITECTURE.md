# Architecture

## Runtime

Captivate is a Next.js web application deployed to Vercel with Supabase providing authentication, Postgres persistence, object storage, and selected realtime primitives.

## Architectural layers

### Web application

- App Router routes and layouts.
- Server Components for data-oriented surfaces.
- Client Components for editor interactions, timeline manipulation, presenter controls, pointer/annotation layers, recording, and browser APIs.

### Domain layer

Keep presentation semantics independent from UI components. Domain types/services should represent presentations, scenes, blocks, timelines, notes, assets, presenter sessions, and recordings.

### Persistence layer

Supabase repositories/adapters own database and storage access. UI code should not scatter raw Supabase queries across components.

### AI layer

Server-only provider adapters. Product workflows call internal interfaces for outline generation, scene drafting, revision, notes, and media assistance. Store enough structured metadata to reproduce/edit the result without locking the product to one provider.

## Presenter/audience architecture

This is a critical boundary.

Presenter and audience are separate render surfaces. A `PresenterSession` owns synchronized public state such as active scene, active beat, audience annotations, and approved pointer effects. Private presenter state stays local to the presenter surface.

Candidate browser architecture:

- Presenter opens/controls an audience window using `window.open()`/Presentation API where available.
- Same-origin `BroadcastChannel` or a carefully defined message channel synchronizes local windows.
- Realtime transport can later synchronize remote audience/co-presenter sessions.
- Audience renderer consumes a restricted public session state, not the presenter React tree.

Do not transmit speaker notes, private timers, camera preview controls, or administrative state to the audience channel unless a future feature explicitly requires it.

## Scene model

Scenes should not be hard-coded as 16:9 pixel canvases. Store semantic/responsive layout data. A scene may declare an aspect preference for traditional screen presentations, but the rendering system must support fluid responsive composition.

Blocks should have stable IDs. Animation/reveal events target IDs rather than array positions so reordering does not corrupt timelines.

## Recording architecture

Prefer browser-native capture primitives first:

- `getUserMedia` for microphone/camera;
- `getDisplayMedia` or a dedicated audience-render capture strategy for screen/output;
- `MediaRecorder` where browser support and quality are acceptable;
- chunked/durable upload rather than holding an entire long recording only in memory.

Treat recording/export as a subsystem with explicit state: preflight, armed, recording, paused, finalizing, uploading, processing, ready, failed/recoverable.

## Data model starting point

Tables are expected to include:

- profiles
- presentations
- presentation_members
- scenes
- blocks or structured scene_documents
- speaker_notes
- lecture_notes
- assets
- themes
- presentation_versions
- presenter_sessions
- recordings

Exact normalization should be decided during schema implementation. Every user-owned/membership-scoped table requires RLS.

## Reliability rules

- Presentations render without AI availability.
- Autosave failures are surfaced and retryable.
- Recording failures preserve recoverable chunks where feasible.
- Audience rendering cannot depend on editor-only bundles/state.
- Migrations are forward-only and reviewed with RLS policies.
