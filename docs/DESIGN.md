# Design Direction

## Design goal

Captivate should feel like a premium creative instrument: calm while authoring, dramatic when presenting, and almost invisible to the audience.

## Important interpretation rule

Any existing mockup, wireframe, generated screenshot, or prototype is a **directional artifact**. It may express useful structure, hierarchy, or feature ideas, but it is not a pixel target. Improve it aggressively when a better solution exists.

## Visual principles

- Strong hierarchy with fewer, better surfaces.
- Spacious composition instead of dense dashboard chrome.
- Controls appear contextually; the canvas/content remains dominant.
- Use typography, scale, spatial movement, and media as primary visual tools.
- Avoid excessive nested cards, generic SaaS tables, rainbow gradients, and “AI sparkle” decoration.
- Use color intentionally for state, emphasis, theme, and semantic meaning.
- Presentation themes may be expressive; the authoring shell should remain neutral enough not to compete with them.

## Motion principles

Motion is part of the presentation grammar, not decoration.

Every animation should answer at least one question:

- Where did this object come from?
- What changed?
- What should I look at now?
- How are these two scenes spatially related?
- What is the narrative progression?

Use Motion for React for orchestrated component transitions. Prefer transform and opacity. Support reduced motion. Avoid continuous background animation unless it has a clear storytelling purpose.

## Authoring shell

Recommended shell anatomy:

- slim global navigation;
- collapsible scene/section rail;
- dominant responsive authoring canvas;
- contextual inspector that can collapse or float;
- command/search surface;
- notes/timeline drawers that appear when relevant.

Do not permanently dedicate large screen regions to controls that are only occasionally used.

## Presenter surface

Presenter mode should feel like a professional production console, not a second editor. It should prioritize current state, next state, private notes, time, and a handful of presentation tools. Movable panels must have sensible default placement and one-click reset.

## Audience surface

The audience view is content-only. No application navigation, editing affordances, presenter notes, timers, tool palettes, selection handles, browser-looking chrome, or accidental cursors.

## Typography

Use a modern variable sans for product UI and allow themes to choose expressive display/body pairings. Keep product UI type sizes compact but readable; presentation typography should scale fluidly with viewport/container dimensions.

## Accessibility

- Minimum WCAG AA contrast for product UI.
- Visible focus treatment.
- Keyboard access for all essential authoring and presenter actions.
- Reduced-motion mode.
- Do not encode state with color alone.
- Generated themes must be contrast-checked before being offered as production-ready.
