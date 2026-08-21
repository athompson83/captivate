# File Structure

The repository should evolve toward feature-oriented boundaries rather than a flat collection of UI components.

```text
captivate/
├─ app/
│  ├─ (auth)/
│  ├─ (app)/
│  │  ├─ library/
│  │  └─ presentations/[presentationId]/
│  │     ├─ edit/
│  │     └─ present/
│  ├─ audience/[sessionId]/
│  └─ api/
├─ components/
│  ├─ ui/                 # small reusable primitives only
│  └─ captivate-shell.tsx # temporary foundation shell
├─ features/
│  ├─ library/
│  ├─ editor/
│  ├─ scenes/
│  ├─ timeline/
│  ├─ notes/
│  ├─ presenter/
│  ├─ annotations/
│  ├─ recording/
│  ├─ assets/
│  ├─ themes/
│  └─ ai/
├─ domain/
│  ├─ presentation/
│  ├─ presenter-session/
│  └─ recording/
├─ lib/
│  ├─ supabase/
│  ├─ ai/
│  ├─ validation/
│  └─ utils/
├─ supabase/
│  ├─ migrations/
│  └─ seed.sql
├─ tests/
│  ├─ unit/
│  ├─ integration/
│  └─ e2e/
├─ docs/
├─ public/
└─ .github/workflows/
```

## Rules

- Keep feature-specific components, hooks, actions, tests, and state inside the feature until they are truly shared.
- `components/ui` is for generic primitives, not domain widgets.
- Domain code should not import React.
- Supabase access belongs behind server/repository boundaries except intentionally client-safe realtime/auth helpers.
- Audience renderer must not import presenter-only panels or private state stores.
- Avoid a generic `utils.ts` dumping ground; group utilities by concern as the codebase grows.
