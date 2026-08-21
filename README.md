# Captivate

Captivate is an open-source, AI-assisted platform for creating and delivering **web-native, animated presentation journeys**.

Captivate is not a PowerPoint clone. The product goal is to make presentations feel like polished interactive web experiences while keeping authoring approachable for educators, trainers, executives, and creators.

## Product thesis

Traditional slide software forces modern content into a fixed-slide metaphor. Captivate combines structured presentation authoring, rich media, motion, presenter tooling, lecture notes, recording, and AI assistance in one browser-based workspace.

The core experience has three surfaces:

1. **Library** — organize, search, duplicate, tag, and manage presentations and lecture notes.
2. **Studio** — author a presentation as a sequence of scenes/sections with responsive layouts, media, animation, and AI-assisted creation.
3. **Presenter** — deliver without browser chrome, with private notes, timers, laser pointer, spotlight/highlight, drawing, navigation, and recording controls.

## Non-negotiable product principles

- Web-native and responsive, not a canvas imitation of legacy slide software.
- Animation and transitions are first-class primitives.
- Presenter tools must never leak onto the audience display or exported recording unless explicitly intended.
- Authors can start from AI, templates, imported material, or a blank presentation.
- AI output is editable and never treated as the source of truth.
- Accessibility, keyboard operation, performance, and reduced-motion support are product requirements.
- Existing mockups and wireframes are **directional concepts only**. They communicate product intent, not final visual quality. Production UI should materially exceed them.

## Technology baseline

- Next.js 16 + React 19
- TypeScript
- Tailwind CSS 4
- Motion for React
- Supabase for authentication, Postgres, storage, and realtime collaboration primitives
- Vercel for hosting and preview deployments

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for boundaries and [`docs/DESIGN.md`](docs/DESIGN.md) for the visual system.

## Local development

```bash
npm install
cp .env.example .env.local
npm run dev
```

Then open `http://localhost:3000`.

## Documentation map

- [`CLAUDE.md`](CLAUDE.md) — implementation instructions for Claude
- [`AGENTS.md`](AGENTS.md) — agent operating rules
- [`docs/PRODUCT.md`](docs/PRODUCT.md) — product definition and users
- [`docs/FEATURES.md`](docs/FEATURES.md) — feature specification
- [`docs/DESIGN.md`](docs/DESIGN.md) — visual and interaction direction
- [`docs/UX.md`](docs/UX.md) — journeys and experience rules
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — system architecture
- [`docs/FILE_STRUCTURE.md`](docs/FILE_STRUCTURE.md) — intended repository layout
- [`docs/CONNECTIONS.md`](docs/CONNECTIONS.md) — external systems
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — implementation phases
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — durable architectural decisions

## Current status

Foundation/scaffold stage. The code in this repository establishes the product shell and implementation contract; it is not a completed UI.
