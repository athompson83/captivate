# Architecture Decision Log

This is a lightweight decision log. Add durable choices here when changing them would cause meaningful rework.

## ADR-001 — Web-native scenes, not fixed slide canvases

**Status:** Accepted

Captivate models presentations as responsive scenes and blocks. Traditional 16:9 presentation rendering is supported as a presentation context, but it is not the canonical authoring data model.

**Why:** The product's differentiation depends on spatial motion, responsive composition, mixed media, and presentation journeys that are not constrained by legacy slide geometry.

## ADR-002 — Separate presenter and audience surfaces

**Status:** Accepted

Audience rendering is a separate surface with an explicit public synchronization contract. Presenter-only data is not part of the audience component tree.

**Why:** Hiding private controls with CSS is too fragile for notes, timers, recording controls, camera previews, and presenter annotations.

## ADR-003 — AI is an adapter-driven authoring capability

**Status:** Accepted

AI providers are server-side adapters. Generated content is translated into Captivate's structured domain model and remains editable with normal authoring tools.

**Why:** This avoids provider lock-in and prevents AI-generated presentations from becoming opaque blobs.

## ADR-004 — Motion for React as default motion orchestration

**Status:** Accepted

Use Motion for React for application/presentation choreography, while still using browser-native CSS/View Transition capabilities when they are simpler or more performant.

**Why:** Captivate requires a robust, deliberate motion system with React integration, sequencing, gesture support, and agent-accessible implementation guidance.

## ADR-005 — Supabase + Vercel baseline

**Status:** Accepted

Use Supabase for auth/Postgres/storage and Vercel for Next.js hosting/Preview deployments unless future scale or media-processing requirements justify specialized infrastructure.

**Why:** This keeps the initial operational footprint small while preserving standard Postgres and web-platform boundaries.
