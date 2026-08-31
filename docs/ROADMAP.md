# Roadmap

What Captivate does not do yet, and the shape each thing would take. Written
so the next person to pick one up starts from a position rather than a wish.

Nothing here is built. `docs/FEATURES.md` describes what exists; this file
describes what does not, and the rule that documentation is accurate about
what exists includes being accurate about what doesn't.

Two entries were asked for by name — audience feedback and plugins for
neighbouring tools — and each is really several features that share a
mechanism. The mechanism is the interesting part, so that is what is written
down.

---

## Audience feedback

**The ask:** surveys, trivia, Q&A — ways the room answers back.

**Why it is one feature and not three.** All three are the same shape: the
presenter opens a question, the room answers from their own devices, the
answers aggregate live, and the result becomes something the presenter can
show on the stage. What differs is only whether the answers are ranked (Q&A),
scored (trivia), or counted (a poll).

**What already exists to build it on.** More than it looks:

- The phone remote (`/present/[id]/remote`) is already a second device joined
  to a live presenting session over a Supabase Realtime channel, with the
  channel gated by `captivate_remote_topic_open` so joining requires a session
  that is actually running. An audience device is the same problem with the
  authorisation inverted — many anonymous participants rather than one
  authenticated presenter.
- The share-link viewer (`/v/[token]`) already establishes how an
  unauthenticated visitor is given exactly one deck and nothing else: a
  capability token resolved by a database function that never selects
  presenter material. An audience join code is that pattern with a shorter,
  human-readable token.
- `presentation_sessions` already models a live run of a deck.

**The parts that are genuinely new.**

- _An audience identity that is not an account._ A participant is a browser,
  not a user. That means a per-session anonymous id, rate limiting that cannot
  lean on `auth.uid()`, and a hard rule that a response row can never be read
  back by another participant — only aggregated.
- _Aggregation that is safe to show._ The stage renders the count, never the
  responses, unless the presenter promotes one deliberately. A live word cloud
  of unmoderated audience text on a projector in a lecture theatre is a
  well-known way to end a career.
- _A question as a first-class thing on the canvas._ A poll is not a scene
  decoration; it is a beat with a purpose and a takeaway, which means it
  probably belongs in the narrative map as a moment kind rather than as an
  element type.
- _Results that outlive the room._ A talk's answers are data the presenter
  wants afterwards, which means storage, ownership and RLS from the first
  commit rather than bolted on.

**The order to build it in.** Anonymous join and one poll question end to end,
counted and shown. Everything else — trivia scoring, Q&A ranking, moderation —
is a variation on a working loop and is cheap once the loop exists.

**What it must not become.** A separate app the presenter alt-tabs to. The
reason to have this inside Captivate at all is that the question is part of the
argument; if it is not on the canvas and in the map, a dedicated polling tool
does it better.

---

## Plugins for neighbouring tools

**The ask:** confidence-monitor software, Descript, and other tools presenters
already run.

**Why "plugin" is the wrong first word.** Each of these is a different
integration in a different direction, and calling them one thing hides that:

| Tool                                | Direction        | What it actually needs                                  |
| ----------------------------------- | ---------------- | ------------------------------------------------------- |
| Confidence monitors, stage displays | Captivate → them | A read-only live feed of scene, notes, timer            |
| Descript, editors                   | Captivate → them | A recording plus its scene markers, in their vocabulary |
| Teleprompters                       | Captivate → them | Speaker notes as a timed script                         |
| Slide remotes, clickers             | Them → Captivate | Already solved: they present as keyboards               |
| OBS, streaming                      | Both             | A browser source, plus scene changes as events          |

**The one thing that unlocks most of it.** A **presenter state feed**: a
documented, versioned, read-only stream of what the presenter console already
knows — current scene, elapsed and remaining time, the running order, the
current notes, whether a build step is pending. The console is already fed by
exactly this, over a channel with a versioned protocol; the work is making it
an addressable, authenticated surface rather than an internal one, and holding
it stable.

Given that feed, a confidence monitor is a page somebody else can write, OBS is
a browser source, and a teleprompter is a rendering choice.

**Descript is the different one,** and it is an export rather than a feed.
Captivate already produces a recording with scene markers and a transcript;
Descript's value is editing that recording by editing its text. The
integration is therefore: the video, the transcript in a format Descript
imports, and the markers as chapters. Most of that exists — what is missing is
the packaging.

**The rule for all of it.** An integration that reads presenter material is
reading exactly the thing the load boundary exists to protect (see
`docs/ARCHITECTURE.md`). Every one of these surfaces must be authenticated as
the presenter, scoped to one running session, and revocable — and none of them
may widen what `/present/[id]` itself loads.

---

## Also wanted, smaller

- **More templates and more themes.** Both are data (`src/lib/templates/`,
  `THEMES` in `src/lib/schema/theme.ts`) and neither needs new machinery. The
  bar is that a theme has a genuinely different point of view and a template
  proposes a shape an author would not have thought of — six of each that
  disagree with one another beat twenty that do not.
- **Generating from a reference file.** An author with an existing deck, a
  paper or a lesson plan should be able to hand it over and have the argument
  grounded in it. The evidence mechanism already exists — the narrative map
  cites `evidenceIds` and generation is told never to claim more than the
  evidence supports — so this is an ingestion problem (extract text, store it
  as an asset, offer it as evidence) rather than a prompting one.
- **Keynote-native export.** Today's export writes `.pptx`, which Keynote
  opens. A true `.key` file is an undocumented package format with no writer
  worth trusting, so this stays unbuilt until that changes rather than being
  half-done.
