# Progress

## Current State

- Product: Captivate
- Lifecycle stage: Beta / production-readiness
- Control-graph node: HOSTED_RUNTIME_VERIFICATION — production driven end to
  end by the suite itself. The suite found two defects; both were fixed and
  deployed, and the fixes were re-proved against the running deployment on
  2026-09-03
- Current milestone: Close verified release gaps and prove the canonical hosted
  runtime
- Branch: `claude/presentation-experience-redesign-r10l4q`, restarted from
  `main` after PR #88 — full screen by hand on the shared viewer, by either
  API name, awaiting CI, merge and production verification; this branch also
  carries the MVP-021 closeout
- `main`: through PR #88 (merged) — `f1c6c93`; every migration through
  `0030_shared_backdrop_asset.sql` applied to production (no migration since)
- Brand: Captivate is the product; Axtevi is the company it sits under
  (`captivate.axtevi.com`). No domain is hardcoded — redirects build from
  `NEXT_PUBLIC_SITE_URL`.
- Production: live and in use at `https://www.axtevi.com`; the owner tests
  deployed builds and reports defects
- Database: canonical Supabase project `qnbwyymwhvqprjtyfdmb`. Every migration
  through `0026_pin_helper_search_path.sql` is **applied to production**.
  `0022`–`0026` were applied on 2026-09-01 ahead of the PR #48 deploy — that
  order is required, because `0022` drops the reservation overload the previous
  build calls, so the reverse leaves `/settings` and `/pricing` reading tables
  that do not exist yet. Verified back out of production afterwards: exactly one
  `captivate_reserve_generation` overload, 16 `plan_budgets` rows, 3
  `ai_model_rates` rows (9 after `0027`), `stripe_events.completed_at` and
  `ai_generations.credit_id` present, one select-only policy on
  `generation_credits`, and `captivate_credit_spent` / `captivate_model_cost`
  executable by no role at all.

## Latest Session

### Full screen by hand

The viewer's full screen was reachable only by the F key, and a phone has no
F. It is now a button in the corner beside the attribution, shown only where
the browser can do it — an iPhone cannot — and a refusal (inside a frame, on
a managed device) is said aloud as the stage already says it, rather than a
button that silently does nothing. Underneath, the hook now speaks both
names: Safari on iPad still exposes only the `webkit` fullscreen API, and a
hook that read the standard names alone reported a fullscreen deck as
windowed and never asked for one (`lib/present/fullscreen.ts`). Support is
read with `||` rather than `??`, because a browser whose standard flag is
false and prefixed flag true is asking to be used by the prefixed name.

Tests: the element is found under the prefixed name; the request falls back
to the prefixed name and refuses when neither exists; support comes from the
prefixed flag; a phone with neither is unsupported; a prefixed change event
is followed and a refusal is reported; the viewer's button asks for full
screen and never advances the deck.

### Three, two, one

Pressing Start in the recording dialog acquired the streams and began the
file on the same tick, so the first second of every recording was the
presenter closing a dialog. Now the streams are acquired, the dialog closes,
a count runs over the stage — one number a second, from three
(`lib/record/countdown.ts`, `recording-countdown.tsx`) — and `MediaRecorder`
starts on zero. The count is never in the file, because nothing is being
captured until it ends. Escape or the button cancels, which releases the
streams exactly as an error would, without the toast; unmounting mid-count
aborts it too. The number is announced assertively for a presenter who cannot
see the stage, and under reduced motion it changes without the settle.

Tests: the count shows each number a second apart and resolves a step after
the last, stops at once when cancelled, and is already over when cancelled
before it began; the overlay announces the number and cancels from the button
or Escape; a source-reading test pins the order in `begin` — prepare, close
the dialog, count, then start — so the count can never reach the file.

**Landed and verified.** PR #88 squash-merged as `f1c6c93`, CI green on the
head. The count needs a real screen-capture permission, which no probe can
grant, so production evidence is the deployment itself: the proxied smoke
suite 37 of 37 against `www.axtevi.com` after the deploy, and the stage route
answering (a redirect to sign-in for an anonymous request, as designed).

### A share link on a phone

A share link is opened on a phone more often than anywhere else, and a phone
has no arrow keys: the viewer's only moves were keys and click zones, and
nothing stopped a pull at the top of the deck from refreshing the page. Now
the viewer, the landing page's live demo and the stage move on a swipe — left
for on, right for back, the same two moves as the click zones, which stay
(`lib/present/swipe.ts`). The recogniser is strict: a short, mostly horizontal
journey; a scroll or a hesitation does nothing, so the page never moves under
a reader who was only steadying a thumb. The click a browser synthesises
after a touch swipe is swallowed once, and only the click of that journey —
the flag clears when the next pointer lands, because a swipe whose click never
came used to eat the tap that followed. Along the way a real bug: a tap on a
hotspot bubbled to the click zone and dived _and_ stepped on, and inside the
aside the step was the way straight back out; a click on a control is now the
control's alone. `touch-action` keeps pinches the browser's and gives sideways
to the viewer (and up and down to the page, on the landing demo);
`overscroll-behavior` ends pull-to-refresh over a deck. The invitation says
"swipe or tap" to a coarse pointer, read as an external store so the first
client render agrees with the server.

Tests: the recogniser's thresholds each way; the control guard; the hook
reports a swipe, swallows the click that follows and not the tap after; the
viewer and the demo move on a swipe and not on a scroll; a hotspot tap dives
and stays; the browser suite runs the viewer as a phone (`hasTouch`,
`isMobile`, 390×844) and swipes it through the deck, then taps the left edge
back. `npm run verify` green; lifecycle browser suite 8 of 8.

**Landed and verified.** PR #86 squash-merged as `6bdbfa7`, CI green on the
head. Probed `www.axtevi.com` as a phone (Pixel 7 emulation, coarse pointer)
after the deploy: the live demo's invitation read "Swipe or tap the stage to
move through"; a vertical journey left it on "Scene 1 of 11"; swipes to the
left walked it to "Scene 2 of 11: The room leaves early" and one swipe to the
right returned it to scene 1; the stage's `touch-action` resolved to
`pan-y pinch-zoom`; empty console. Smoke suite 37 of 37 through the proxy.

### The show opens and closes on the whole of itself

Both audience surfaces cut straight onto scene one with the camera already
landed, and past the last scene they flipped to the overview and stopped: no
first impression, no last one, and a white flash from the site's light body
before either arrived on a projector. Now a show opens wide — the camera over
the whole argument with the route drawn, a beat, then the dive to the first
scene (`lib/present/opening.ts`, session state `opening`). It is the second
half of the one move the room asked for, starting the show, and it does for
the whole presentation what establishing does for a section. The first press
ends the beat and lands rather than steps; a presenter who pulls back during
it stays there; reduced motion makes it a cut; a one-scene deck does not open.
Past the last scene the same pull-back is marked as the end (`ended`) and
dressed: after the flight lands the lights come down around the centre and the
title is set over the whole of it (`closing-frame.tsx`) — the last thing the
room sees and, since a recording captures the stage as shown, the film's
outro. The shared viewer and the landing page's live demo open and close the
same way. `loading.tsx` under `/present/[id]` and `/v/[token]` paints a black
frame while the deck is awaited, so a projector never flashes white.

Tests: the session holds, dives, lands on the first press, keeps a hand-pulled
overview, cuts under reduced motion, tears its timer down with the session,
and marks the end only past the last scene; the hook does the same for the
self-driven viewers; the shared viewer and the live demo open wide and settle
in jsdom and in a real browser, where the fixtures record the first view
in-page because the beat is shorter than a couple of round trips; the closing
frame names the deck and passes clicks through; both load frames are black.
`npm run verify` green; lifecycle browser suite 7 of 7.

**Landed and verified.** PR #84 squash-merged as `298bacd`, CI green on the
head. Probed `www.axtevi.com` through a real browser after the deploy: the
live demo's first view, recorded in-page from the moment it mounted, was the
opening hold; it dove on its own to "Scene 1 of 11: Title"; past the last
scene the closing frame read "Hold the room" at opacity 1; one press back
returned to a scene with the frame gone; empty console. Smoke suite 37 of 37
through the proxy.

### Depth inside the scene

The owner's guidance, sent a third time, lists depth without WebGL among its
practices — CSS layers at different distances. Everything behind a scene
already had depth: the backdrop on its plane, the atmosphere's motes at
three distances. The scene itself was the one flat thing on the canvas: a
picture and the words over it moved as one sheet. Now the words sit a little
nearer than the surface and the pictures a little farther
(`lib/present/parallax.ts`), and as the camera departs or arrives they slide
against each other by an amount proportional to the camera's offset from the
scene's centre, capped at three percent of the stage so a far scene never
scatters. On a scene the offset is exactly zero, so nothing is ever
misregistered while it is being read — the depth shows only in the motion.
The camera loop writes two custom properties per region once a frame and
each element's layer multiplies them by its depth in CSS, so sixty elements
cost two style writes and the compositor moves the layers. Only while
presenting; in the editor an element sits exactly where it was put.

Tests: the offset is zero on the scene, grows with the camera's offset in
the region's own pixels, is capped, turns with a turned region; words are in
front and pictures behind; the world hands the active region a zero offset
and a neighbour a real one, and writes nothing in the editor; the stage
gives elements their depth layers only while presenting.

**Landed and verified.** PR #82 squash-merged as `918109a`, CI green on the
head and on `main`. Production, through a real browser against
`www.axtevi.com`: the live demo renders `.pxl` depth layers; on arrival the
active scene's region reads `--px: 0.00px; --py: 0.00px` and its neighbours
read the cap (`±48.00px` — three percent of the 1600-unit stage); mid-flight
the scene being left and the one being approached both read `33.02px`, and
after landing the new scene reads zero again with the cap redistributed
around it. Empty console. Smoke suite 37 of 37 through the proxy.

### Words that arrive, and a camera that answers the scroll

The owner's guidance for this round was the practice of 3D and animation
work — Three.js, GSAP's scroll-driven pages, Framer Motion — and the two
things in it not yet applied were both about attention. **A heading now
arrives a word at a time** when its scene is performed: each word rises into
place a beat after the one before, so a claim is read in the order it was
written, the typographic equivalent of a sentence being said. Inline-block
spans, so lines still break at the spaces and the auto-fit that measured the
plain text still holds; a CSS stagger, no script; plain headings of up to
fourteen words, everything else whole; the editor, a thumbnail and a scene
the camera is passing show the sentence entire. **The hero's camera answers
the scroll** as well as the clock: as a visitor scrolls the hero away it
pulls back to the whole world, smoothstepped so the first pixel of scroll
does not lurch, so the last thing seen of it is the wide shot the flight was
circling all along. A number read in the frame loop, like the pointer lean;
never state, never a re-render; released with the other listeners.

Tests: a heading performed word by word, whole in the editor, held for the
camera, and whole past fourteen words; the pull-back's shape and clamping,
the blend's endpoints, and the canvas's passive scroll listener wired and
released.

**Landed and verified.** PR #78, squash `95e671e`, six checks green on the
head and `main` green on the merge. Production: the landing page's live demo
on `https://www.axtevi.com`, driven in a real browser through the proxy,
renders the word spans — three on the cover's heading, four on scene four's
after three real flights — with an empty console; the smoke and accessibility
suites 37 of 37 (one navigation timed out at this container's proxy on the
first run and passed on the re-run). Codex remains out of credit, so the
review was the local pass over the diff; the served build could not be read
from here, as before, and the new spans in the live demo are the proof it is
serving this one.

### The scene performs when the camera lands

The owner asked for the most captivating experience the engine can give,
using what 3D, animation and engineering practice know. The first thing that
practice says is that a reveal is only a reveal if the audience is looking at
it — and reading the world showed that nobody was. `onArrive` was fired at
the end of every flight and nothing listened. The scene under the camera was
"playing" from the moment it became active, which is the moment the flight
_began_: every choreographed entrance the layouts already stagger, every
build, the first stroke of every drawn picture, played out in the distance
while the camera was still travelling, and the room landed on a finished
scene. The choreography existed. It was never seen.

**Performed on arrival.** The world now remembers the camera it last landed
on and derives, during render, whether the current target is that camera —
during render, because the destination mounts in the very render that
changes the target, and an element decides at mount whether it is held; a
flag flipped in an effect arrives one render too late. `Stage` takes
`arrived`; an element that mounts while it is false is held at the start of
its entrance, invisible, its sketch undrawn, and performs with its own delay
when it turns true. An element already on screen when the flight begins is
left alone: an entrance is for what the audience has not seen, and a
neighbour that vanished as the camera set off would be a pop. An establishing
shot over a section and the overview are landings too, and count for nothing
here — a scene performed at either altitude would perform in the distance
again.

**Two things that only happen when performed.** The one-number layout marks
its number as a `figure`, and on arrival it climbs from zero to itself in
about a second, slowing into the last digits, written to the text node from a
frame loop in tabular numerals so nothing re-renders and nothing shifts;
ratios and small numbers are shown as they are. A chart builds: columns from
their baseline, bars from their left edge, donut arcs sweeping round in turn,
the line drawing itself with the same measured-dash mechanism as a drawing —
transforms and dashes only, so the compositor does the work. Neither happens
in the editor, a thumbnail, or a scene the camera is passing.

**Attention.** The scene the camera is on is lit; the ones beside it recede
to sixty percent and come back as the camera sets off towards them. Opacity
only — no haze painted over a region, which would be a rectangle on a world
that has none — and never in the overview.

Tests: the stage holds, performs, leaves a pre-flight element alone and never
holds in the editor; the count-up's parsing, formatting and easing; charts
building only when performed; the world holding a far destination through a
flight, arriving at once on a cut, holding through a section's establishing
shot, and dimming neighbours while presenting but not in the overview or the
editor.

### The landing page runs the product

The owner's brief for the landing page was the most captivating on the
internet, with the practices of 3D and animation. The hero already was one:
six scenes in one three.js space, a camera flying between them with pointer
lean and dust for depth, a CSS world beneath it for browsers without WebGL.
What the page did not do was let a visitor _touch_ the thing. Now it does.

**The live demo.** Below the three steps, a section titled "See it move"
mounts the real `World` on the worked example — the deck every new account
opens first, built through the same template machinery creation uses
(`lib/marketing/example-deck.ts`, which the share-link viewer's browser
fixture now imports rather than carrying its own copy). Press → or tap the
stage and the camera flies; the scene performs on landing; the last press
pulls back over the whole argument. Deliberately not the share-link viewer,
which is a whole page that listens on `window` for every arrow, Space and
Backspace — on a marketing page that would hijack scrolling — and carries
chrome pointing back to where the visitor already is. The demo's keys work
while the stage has focus, and Back, Whole map and Next beside it do the
same for anyone who would rather click, with a line saying where they are.
The engine is fetched only when the section comes within half a screen, into
a box already the right shape, so nothing below it moves. The hero offers
"Or see it move ↓".

**Things that rise into view.** The step cards, the feature cards and the
pricing card rise as they enter the viewport — scroll-driven animation in
CSS with no library and no scroll listener, gated behind `@supports` so a
browser without view timelines shows a still page, which is a complete page,
and reduced motion asks for exactly that.

Tests: the example deck's rows are stable and every scene's section exists;
the demo is a labelled, focusable region that walks the deck from the
keyboard and the buttons, pulls back after the last scene, and comes back
in; a lifecycle spec mounts it in a real browser inside a scrolled page,
proves a key on the page does not move it and a key on the focused stage
does, and that the camera loop raises no error; the production smoke suite
checks the section and the hero's way to it.

**Reviewed and landed.** Codex is still out of credit, so the review was a
local pass over both commits. It found five real things, all fixed with a
test each: a scene that mounted mid-flight went blank when the presenter
pulled back to the overview, because the hold re-engaged whenever `arrived`
went false — it now releases at the first landing and never returns;
figures counted and charts built the moment a pre-mounted neighbour became
the destination, mid-flight — both now key on the landing itself; the line
chart's dash draw-in read its length in user units and its dash in screen
pixels under `non-scaling-stroke`, so it rendered as a dash pattern — it is
now a left-to-right clip reveal, which is what a line chart should do; the
figure parser swallowed a trailing comma and rewrote "007" — it groups
strictly and shows as written anything it would change; and the count-up's
text write detached React's text node, so the span is keyed on its text. A
section's establishing shot also dimmed every scene but one; dimming now
applies only when the camera is on a scene. CI's axe scan then found the
demo placeholder's title at 3.65:1 on the mobile viewport, raised to 65%
white and reproduced locally at every viewport before the push. Six jobs
green on `83399da`, squash `f62aa86`.

**Production.** The landing page redeployed within two minutes of the merge
(its chunk list changed, and the HTML carries "See it move"). Driven
through the proxy in a real browser, the demo loaded, took four presses
from the title to scene 5 of 11 with the camera flying between them, and
raised no console error. The smoke and accessibility suites pass 37 of 37 through the proxy on the new build.
Not verified here: the performance-on-arrival change on a physical GPU in a
real room — the owner's next presentation is that test.

### "Generation failed" on a phone, over a deck that had finished

The owner generated a thirty-minute talk from their phone and got "Couldn't
reach the server". Twice. The database said otherwise both times: two
presentations titled "Homeostasis: The Baseline You're Actually Assessing",
five movements, seventeen moments, every scene written, each finished about a
hundred and ten seconds after it was created. The ledger put the scene call
at 94 and 104 seconds and the map call at 58. Vercel's logs are closed to
this session's token, so the diagnosis rests on those rows and on how the
route answers: it said nothing until it was done, and iOS abandons a request
that has received no bytes for sixty seconds and calls it a network failure.
The toast then told the owner the deck "may already be in your dashboard
with its structure but no scenes yet", which was wrong on the one point that
mattered, so they generated again and had two.

**The fix is bytes, not a shorter route.** `lib/ai/keep-alive.ts` wraps the
work of every route allowed to run past a minute — `map`, `create-from-map`,
`scenes-from-map`, `visuals/draw`, `visuals/generate`: the headers go out at
once, a newline of JSON whitespace follows every ten seconds, and the route's
own JSON is the last thing written. Leading whitespace is valid JSON, so the
clients read the body exactly as before. What a streamed response cannot do
is choose its status after the fact, so a long route's failure now travels as
the `error` field of a 200 body, and both clients (`lib/ai/client.ts` and the
map view's scene generation) treat that field as failure whatever the status.
The guards that produce a real status — signed out, rate limited, malformed —
run before the wrapper and keep theirs. A source-reading test fails on any
route with a `maxDuration` past sixty seconds that does not return this way.
The scenes call's own attempt budget rises from 100 to 140 seconds, since the
ledger shows a seventeen-moment deck within seconds of the old one; and the
toast for a genuine network failure now says the deck may be in the dashboard
"possibly with its scenes written", and to retry only if it is not.

**Reviewed and landed.** Codex is out of credit, so the review was a local
pass over the diff, which found two things worth fixing: the image panel
cleared its busy state when `fetch` resolved — with streamed headers that is
at once, not when the picture lands, so a second click could start a second
paid generation — and a route that threw behind the stream reached the
author as a polite sentence and the operator as nothing, where before it was
a logged 500. Both fixed and tested. PR #74 then sat with no CI run at all
for a quarter of an hour: the branch still carried the closeout commit that
`main` had received by squash, both sides had since touched the status
files, and GitHub cannot build the merge ref for a conflicted pull request so
it silently skips the `pull_request` workflow. Merging `main` in and taking
the branch's status files resolved it; every job went green on `816a95a`,
squash `0211aa9`, `main` green on the merge.

**Production.** The smoke and accessibility suites pass 37 of 37 against
`https://www.axtevi.com` through the proxy (two navigations timed out at
the proxy on the first run and passed on the re-run). The five wrapped
routes answer an unauthenticated call with the sign-in redirect in under a
quarter of a second, as before. Not readable from here: which build the
domain is serving — Vercel's project and deployment APIs refuse this token,
and the landing page's chunk list is unchanged because nothing it loads was
touched. Every previous merge has deployed within a minute; the owner's
phone is the test that matters, and the ledger will show it either way.

### Three things the owner could not find, or see — undo, a backdrop, and drawings that are drawn

The owner's second report after using the shipped build: the drawings are
still rough, there is no option for a 3D image background for the whole
show, and the editor needs an undo button.

**Undo.** It existed. The header's undo and redo buttons faded to thirty
percent opacity whenever the history was empty and folded into the "More"
menu on a narrow window, which is how the two most-used controls on the page
came to be reported as missing. They are now a bordered, labelled group: in the
header on a wide window, and on the view-switcher row on a narrow one, where
the narrow editor spec caught the first version pushing Present off the
header at 320px.

**A backdrop with depth.** The atmosphere's depth layer is automatic and
subtle; the owner wanted a picture. `JourneyConfig.backdrop` is one image
behind the whole show, chosen in the journey panel from the same asset
picker as any image (upload, library, URL, and stock or generation where
configured), with a distance and a dim. It sits on a plane some scene-widths
behind the content, so a flight slides it slower than the scenes and a zoom
grows it less — the same projection as the depth layer, with a photograph on
it — and it is perfectly still on a scene. `lib/present/backdrop.ts` is pure
and tested: the plane covers the viewport at the widest framing, a pan moves
it less than the content and less again the further away it is, a dive grows
it less than the content, and a still camera leaves it still. Stored decks
that predate the field parse with no backdrop.

**Drawings that are drawn.** The illustrator brief with construction recipes
was tried on the real provider and the owner's verdict was "still rough" —
a model can reason about what goes where and cannot draw a curve, however it
is briefed. So it no longer draws. It composes a diagram (`lib/drawing/
diagram.ts`): shapes and symbols in boxes on an 800×500 canvas, arrows
between them, each with a stage; and `compileDiagram` turns that into strokes
with recipes designed once — circles from arcs, boxes from quadratics, clouds
as smooth curves through bumps, arrows clipped to the edges of what they
join with heads sized to their shafts. Symbols are the Lucide icon set read
as path data (about a hundred curated names) and scaled into their boxes at
the weight each icon was designed for. The compiler's path transformer
found two grammar corners the old bounds parser also had: a path's opening
relative move is absolute, and an arc's two flags are single digits that may
run straight into the next value (`a6 6 0 01-8.943 0`) — the face that lost
its mouth. Both parsers now share one arc-aware tokenizer. The output is the
same `DrawnPath[]` as before, so staging, weights, accent, fills, the editor,
the export and the audience boundary are untouched; only the pictures
changed. Rendered samples at projector size — a heart, a vessel and tissue;
a person, an ambulance and a hospital; two faces exchanging — look designed
rather than sketched.

**Review, release, evidence.** Codex found three things: a P1 — a backdrop
stored as an asset is referenced from `presentations.journey`, and the
shared-asset resolver only read `scenes.content`, so every logged-out viewer
of a shared deck would have got a 404 for the picture — and two P2s, edges
naming a node that does not exist were silently dropped rather than refused,
and an arrow into a circle drawn narrower than its box was clipped to the
box. Migration `0030_shared_backdrop_asset.sql` teaches both resolvers the
backdrop reference and the RLS suite proves it for a shared deck and denies
it for an unshared one; the diagram schema refuses duplicate ids, dangling
edges and self-edges at the model boundary; `boundaryPoint` clips a circle
to the radius the recipe draws. `0030` was applied to production before the
merge. PR #72 merged as `24a287a` on a green head; production rebuilt (the
static asset fingerprint changed within a minute of the merge), the
resolvers in `qnbwyymwhvqprjtyfdmb` read back as honouring
`journey.backdrop.assetId`, `SECURITY DEFINER` with a pinned `search_path`
and executable by anon and authenticated, and the proxied `smoke` and
`accessibility` suites passed 37 of 37 against `https://www.axtevi.com`.
Not verified here: a real provider composing under the new brief (BETA-003)
and the backdrop on a physical GPU (BETA-002). The merged branch could not
be deleted from this environment — its git proxy refuses a delete refspec,
as recorded earlier — so `claude/backdrop-diagrams-undo` is still on the
remote and is safe to delete.

### The presentation experience: depth, points, and drawings that hold up

The owner's brief: a background with genuine depth that moves during a
transition and stays quiet on a scene; get out of the slides-at-right-angles
mindset; more images, icons, take-home points, calls to action and simple
explanations; and drawings that are not weak. Four changes, each with the
test that would have failed without it.

**Depth in the air.** The atmosphere shader gains three layers of soft motes
at 0.6, 2.2 and 6 scene-widths behind the content. Each is the content plane
seen by a camera that far back — its world-units-per-pixel is the camera's
plus the distance over the viewport — so a pan slides a far layer slower and a
zoom grows it less: real parallax, not a scrolled texture. At rest they are a
faint drift; in flight they brighten, more of the field appears, and each disc
streaks along the direction of travel. The stirring is measured from
consecutive cameras (`cameraMotion`), rises instantly and settles in 0.4 s
(`settleMotion`), so the transition is the one moment the background is seen
moving. One hash per layer per pixel, no neighbour search; reduced motion pins
it still. The shader spec now renders flat, resting and flying frames and
asserts the dust is faint at rest, stirred in flight, world-anchored under a
pan, and streaked along the heading.

**No right angles — in the content, not the camera.** The first cut tilted
each region of the default `flow` page a degree or two so the pulled-back
view read as a composition rather than a grid. The owner corrected it the
same day: the right angles they meant are the slides and pictures, and a
camera that rolls the horizon on every flight is a motion-sickness risk. The
tilt is gone (`flow` places level, and a test now holds `flow`, `reel` and
`grid` at zero rotation). In its place, `ImageElement.edge`: every composed
picture — split scenes, explainers, full-bleed backdrops, the cover's veil —
and every picture an author inserts is `soft`, rounded generously and
feathered on all four sides by a mask so it pools into the page rather than
ending at a hard line. Stored rows keep their hard edge; the inspector offers
both.

**Points, not pages.** Four layouts: `takeaway` (an icon as large as the
heading, one line of why), `action` (the imperative, up to three icon-led
steps), `figure` (one number set large enough to be the scene, its label, the
claim, one sentence) and `explainer` (a plain sentence, three points — what,
why, what follows — and a picture the drawing pass fills). Their points are
callouts in a new `open` variant with no panel behind them; `three-up`
composes open now too, and open points are set at 1.4 rather than the panel's
0.66, which was seventeen-pixel body text on a sixteen-hundred-pixel stage.
`layoutFor` routes a movement's last claim, evidence, example or synthesis to
a take-home, `application` and `close` to a call to action, `context` to an
explainer, and alternates evidence between a figure and a chart. The scene
prompt teaches the model what each is for and forbids a figure it was not
given; the structural fallback never invents a number. `figure` round-trips
through `extractContent` by element-id contract, the way a cover's veil does.

**Drawings with weight.** A path may carry `weight` (a multiple of the
element's stroke), `ink` (so the idea a stage adds arrives in the accent) and
`fill` (a 14% wash inside a closed shape, arriving once its stroke closes).
Generated drawings are placed at stroke 3, not 2 — two pixels vanished on a
projector. The generator is briefed as an explainer illustrator with exact
construction recipes (a circle is two arcs, a rounded box four quadratics, an
arrow a shaft and a two-stroke head), a weight hierarchy, mass on two or three
shapes, the stage's idea in accent, and no lettering ever. The drawing budget
rises to one per eight minutes (one per four with no photo provider), with
the sole-source ceiling held at the ten every plan sells — the billing test
that couples the two is what stopped it going higher without a migration.

**Tuned by eye, reviewed, shipped.** Rendered at projector size, the first
depth layer was a field of same-sized discs at one density — snowfall, and
on paper a purple one. The near layer became a few large, very soft motes on
a mostly empty lattice, the far layers a finer dust, the flight brings out a
little more of the field rather than all of it, and the light-theme push is
gentler; the shader spec now judges flight by the share of pixels that moved,
the right measure for a field that is sparse on purpose. Codex reviewed the
PR and found four real things, each fixed with the test that fails without
it: the PowerPoint export stripped per-path weight, ink and fill; a
take-home's or figure's body was extracted as a subheading neither layout
draws, so re-applying the layout lost it (prose now returns to the slot it
came from, which also fixes a bullets scene with a paragraph); a
movement-ending application became a take-home instead of a call to action;
and a fill on an open path rendered as a polygon (the schema now requires a
filled path to close). CodeRabbit does not auto-review this repository
(fewer than ten stars); Codex is the reviewer of record.

Verified before merge: `npm run verify` green on every commit; PR CI green
on the final head `0004d9c` (verify, RLS, shader + lifecycle, production-
server routes, signed-in journeys). Verified in production after merge:
the site's static-asset fingerprint changed sixty seconds after the squash
landed (`x-vercel-id iad1::iad1::4x7bs-1788549614320-991df4df275b`), the live
stylesheet carries this change's `dp-wash` and `dp-fill` rules, and the
smoke suite run from this environment against `https://www.axtevi.com` —
through the agent proxy with the documented Chromium switches — passed 37 of
37 on the new build, as it had on the old. Not verified: the depth layer on
a physical GPU and the model's actual drawings against the new brief — both
need a real presentation in a real browser and a real provider (BETA-002,
BETA-003), and remain the owner's to look at.

### An honest error message, and the durability gap it was standing in for — PRs #63, #64

A phone screenshot showed the `/new` flow's toast: "Generation failed —
Couldn't reach the server. Your work is unaffected." Root cause:
`create-from-map` writes the presentation, its movements and its moments
through fast, synchronous Supabase inserts, then calls the slow generation
step inside the same request (`maxDuration = 300`) — one `generateStructured`
call that writes every scene's content in a single model response
(`buildScenesFromMap` in `src/lib/ai/service.ts`), followed by media dressing
run in parallel across scenes, then one bulk upsert of the finished rows. A
dropped connection or a killed function anywhere in that request loses the
response, but not the presentation/movements/moments already committed — so
"unaffected" was false in exactly the case that toast exists to describe, and
a retry from that screen could create a second presentation from the same
map.

PR #63 taught the client (`src/lib/ai/client.ts`) to export that failure as
`NETWORK_ERROR` and taught `create-flow.tsx` to name the real recovery path —
check the dashboard for a deck with this title — instead of implying nothing
happened. PR #64 closed a second case CodeRabbit caught in review of #63 and
that went unaddressed before merge: a resolved, OK response whose body fails
to parse (the connection dropping mid-stream) was falling into a third,
unrelated message that the same `NETWORK_ERROR` check didn't recognize.

**Both PRs are a client-side mitigation, not the fix.** The owner reviewed
the incident and gave explicit direction, recorded verbatim reasoning in
`PROJECT_CHECKLIST.md` (`BETA-006`): raising `maxDuration` further (Vercel
Fluid Compute) would reduce how often this happens without closing the
architectural gap — a request can still fail from a dropped connection, a
runtime kill, a provider interruption, or browser abandonment, and today
every one of those means starting over by hand. Today's `buildScenesFromMap`
also has no unit smaller than the whole deck to resume: one model call
writes every scene's content together, so a malformed response or a single
scene failing validation fails the batch, not just that scene. The root fix
is a durable, resumable generation workflow — a new architecture, not
persistence bolted onto the current one: create the presentation with an
explicit lifecycle state immediately, assign the request an idempotency key,
persist a generation job with progress, generate scenes in bounded units
genuinely smaller than one deck, and let the dashboard
show and act on Generating / Partially generated / Generation failed / Ready.
Fluid Compute is `DEFERRED` as its own later performance/cost decision, not
purchased to patch this. Design has not started; see BETA-006 for the full
acceptance criteria this needs before it can be marked `DONE`.

### A ledger column that cost nothing to falsify — PR #61

`0028` (this branch, opened 2026-09-02) added `ai_generations.provider` so a
human could read off which gateway a settlement actually paid — the question
the first production image row (below) could not answer, because it recorded
only a model string and `CAPTIVATE_IMAGE_MODEL` can make either gateway write
the same one. The fix as first written let a settlement name the gateway
directly, through a `p_provider` argument next to `p_model`.

That repeats a trust boundary this file already accepts and does not close
it. `0020_ledger_integrity.sql` explains at length why a caller can forge
`model` and token counts on their own pending reservation, and why that is an
acceptable trade: a cheap fake model prices the row near zero, which costs the
forger the answer they were generating. `provider` broke that trade. It never
touches `cost_usd`, so a caller could relabel an OpenRouter call `anthropic`,
or the reverse, purely to corrupt the audit column — at no cost to themselves.
An audit trail nobody pays to falsify is not evidence, and Codex's review of
PR #61 said so within four minutes of the PR opening; `athompson83` said the
same thing independently on the PR the next day, in stronger terms, and named
it the blocking finding.

The fix is not a new credential — this deployment has none that distinguishes
the Next.js server from a browser calling the same RPC on the same JWT, and
0020 already explains why one is not cheap to add. Instead `0029_gateway_
from_model.sql` removes `p_provider` as a parameter entirely. Each settlement
function now derives it from the `p_model` it is settling, under the naming
convention this codebase already documents and calls its own — `0027`'s own
comment on OpenRouter's `vendor/`-prefixed ids, mirrored in `DEFAULT_MODEL` and
`DEFAULT_IMAGE_MODEL`. A caller can still forge `model`, exactly as before and
at exactly the cost 0020 already prices in; what is gone is the ability to
name a gateway disconnected from it. Both migrations are applied to
`qnbwyymwhvqprjtyfdmb`; `0029` needed no release coordination with `0021`'s or
`0022`'s, because no build this repository has ever shipped sent the seventh
argument `0029` removes — `0028` gave it a default for exactly this reason,
and the application code never used it.

### The journeys that said "pass" without looking — PR #62

PR #60 fixed the two production defects. This is what happened when the tests
written to prove it were asked to prove it honestly, and it is the more useful
half of the story: **both new journeys passed before either could have.**

**A refusal counted as a success.** The checkout journey ran against a free
account, took the free-plan copy as the end of the story, and reported a pass
without ever pressing an Upgrade button. It gates on the control it drives
now, and skips out loud when there is nothing to drive — a deployment that
sells no tier, or an account holding a granted plan, offers no checkout to
open, and a test that cannot reach its subject must say so rather than agree.

**A tag counted as a picture.** The imagery journey asserted that an `img`
element existed after reload. An element whose `src` 404s is still an element;
`naturalWidth` is what separates a picture from a placeholder. Asserting it
immediately exposed a worse defect in the test itself: the reload raced
autosave, and the polling loop written to wait for the save was destroying it
on every pass. The header says `All changes saved` when idle and `Saved` after
a write, and the loose regex matched the stale idle text — so the test watched
for a state that was already on screen, reloaded into the middle of the write,
and then failed on the picture it had just discarded. It now waits for the
status to leave idle, waits for it to settle, and reloads once. Against
production that journey generates a picture, keeps it, and finds it decoded at
1536x1024 after a reload.

**What the two have in common** is that neither was failing. Both were green,
and both were green for a reason unrelated to the thing they were named after.
A test that cannot fail for the right reason is worse than an absent one,
because it is counted.

**The imagery gate got stricter, and was checked rather than assumed.** The
first fix waited for the header to leave its idle text, which a reviewer
pointed out is still satisfied by the _previous_ edit's "Saved". The gate now
requires a state that can only be about this change — "Unsaved changes" or
"Saving…" — before waiting for the settle. Whether the deployed build shows
that state long enough for an assertion to catch it is exactly the sort of
thing worth checking rather than reasoning about, so a disposable free account
made one edit on production while a 120 ms poll recorded the header: it read
`Unsaved changes`, `Saving…`, `Saved`, in that order. That account and its one
deck were removed immediately afterwards.

**The disposable identity is gone.** The production account created for this
verification was removed in full on 2026-09-03: its four generated images
first, through the product's own delete path so the storage objects went with
the rows rather than being orphaned by a SQL delete, then its 27 decks, the
`ai_generations` and `lecture_notes` rows, the `billing_customers` row and the
`auth.users` record. Read back afterwards: two accounts, 15 decks — 14 of them
the Product Owner's, including the rebuilt copy left for review — and no
storage object under the disposable prefix. Nothing of the owner's was
touched at any point; every mutation this session went to data the session
had created itself.

### Production, driven end to end — and what it was hiding

The whole point of this session was to stop inferring. Every previous record
about the hosted runtime ended in "needs a signed-in production session this
environment does not have"; this one made the session and drove it.

**The account.** A disposable user was created through the production
project's own sign-up endpoint — the same call the sign-up page makes — with a
mailbox on a domain the owner's Resend account receives for, so the
confirmation email Supabase sent could actually be read and followed. It was.
That is also how the first defect surfaced before a single journey ran: both
the confirmation link and a recovery link requested with the app's own
`redirect_to` came back pointing at `http://localhost:3000`. GoTrue checks
`redirect_to` against the allowlist and on a miss writes the Site URL into the
email, silently; production's allowlist does not carry `www.axtevi.com`, and
its Site URL is the default. Every real confirmation and reset has been sending
people to a machine that is not there. It is a dashboard setting with no
management token available here, so it is the one new owner action.

**The suites.** With `CAPTIVATE_E2E_URL=https://www.axtevi.com`: 37 of 37
`smoke` and `accessibility` cases, 28 of 28 signed-in journeys. Getting a
browser to production at all took `--ssl-version-max=tls1.2` and a few
`--disable-features` — the agent container's TLS-re-terminating proxy drops
Chromium's default ClientHello, while `curl` from the same shell gets a 200 —
which is why `CAPTIVATE_E2E_CHROMIUM_ARGS` now exists. Every journey also
records console errors and failed requests and fails on an uncaught page
exception or a 5xx, which is the "console/network inspection" BETA-001 asked
for by name.

**Imagery, proven and then not kept — and then kept.** An image key is set on
production, and every settled text row names `claude-sonnet-5`, which is
Anthropic's own gateway. Which gateway serves _images_ the `ai_generations`
ledger cannot say: it persists a model string, and `gpt-image-2` without an
`openai/` prefix is how OpenAI's default is named and equally what a
`CAPTIVATE_IMAGE_MODEL` override would record through OpenRouter. The fixed
accept path settled it a day later, because `assets.provider` stores the
resolved `IMAGE_PROVIDER` rather than a model: the row written on 2026-09-03
says `openai`. Production's images go through OpenAI, and the OpenRouter
account's exhausted balance cannot reach them. A Pro grant on the
disposable account (the free-plan refusal was asserted first) asked the picker
for a picture and got one from `gpt-image-2` in 41.7 s, with a `succeeded`
ledger row at $0.05. Then
"Use this image" spun forever. The accept path handed the preview data URL —
several megabytes for 1536x1024 — to a server action, which stops reading its
body at 1 MB; the action threw before its first line, the `await` never
settled, and no sentence was shown. The bytes now go from the browser straight
into the caller's own storage prefix, the way every upload already goes, and
only the provenance row goes through an action. The fill pass keeps its bytes
through a `server-only` store, and the two image-signature checkers that had
drifted apart in `visual-sourcing.ts` are one module the browser can use too.

**Basic and Pro, half proven.** `/settings` offers both tiers with an Upgrade
button each, so `STRIPE_PRICE_BASIC_MONTHLY` and `STRIPE_PRICE_PRO_MONTHLY`
resolve at request time. Pressing either created the Stripe customer — in
live mode, which settles which key production holds — and then no Checkout
Session in either mode: Stripe rejected the create call and the action caught
every error into "Couldn't reach Stripe", recording nothing. The billing
actions now log at the choke point and tell a price Stripe does not recognise
apart from an unreachable Stripe, because a price id copied from test mode
into a live-key deployment fails in exactly this shape. The journey reads the
sentence back once PR #60 is live.

**The blank scenes.** The owner's twenty-one-scene deck from 2026-09-01 has ten
empty scenes: nine `statement` layouts whose heading came back empty, and one
blank inserted by hand. The composer defect was fixed by PR #44 — an hour
_after_ that deck was generated, and its comment names one of these very
scenes. Rebuilding the live deck is the owner's call on their own data, so the
rebuilt result was written to a **copy** in their library instead, titled
"…— rebuilt copy (review before use)": every row carried over with ids
remapped the way `duplicatePresentation` does it, the nine statements drawn as
their centred heading by the same composer the app uses, and the original
untouched.

**What could not be read from here, precisely.** The Vercel connector's grant
covers a different project; the Captivate project id is now known from the
bot's PR comment and answers 403 to logs, deployments and configuration. So
stderr lines the observability module writes are still unreadable from this
environment, and the deployment id and built SHA behind `www.axtevi.com`
remain inferred from behaviour rather than read.

### Four releases: the spend boundary, a second gateway, and the stage itself

Shipped to production on 2026-09-01 as PRs #48, #49, #50 and #51.

**#48 — the spend boundary rebuilt.** `captivate_reserve_generation` took its
window and its ceiling as _arguments_, and PostgREST exposes it to
`authenticated`, so the plan gate in front of it was decoration. It now takes a
kind and a budget group and nothing else. Three tiers, a top-up that buys whole
presentations rather than a deck counter, and every text generation priced from
an effective-dated rate table. Eight review rounds; the two that took longest
are recorded above.

**#49 — a test that would have gone stale.** `plan-budget-parity` asserted the
SQL and `plans.ts` agree by reading a _named migration_, which is correct until
something redefines those functions. It now reads the last file that defines
each, the way Postgres applies them.

**#50 — one key runs the whole product.** Captivate needed two accounts to be
whole: Anthropic for text, OpenAI for pictures. An OpenRouter key now does
both. The ordinary path to a gateway is _which keys are set_ rather than a
setting kept in step with them — the failure mode of the latter is a deployment
that names one provider, holds the other's key, and reports itself unconfigured
while both halves look present. `CAPTIVATE_AI_PROVIDER` and
`CAPTIVATE_IMAGE_PROVIDER` still name one outright, and are checked first, for
the deliberate switch; without them the incumbent wins a tie, so an OpenRouter
key added beside a working Anthropic one does not move a running deployment. The
retry policy, error text and schema validation stay shared; a provider supplies
only a `Conversation`.

Also in #50: every generated card was a plain circle, because the generation
schema never offered the model an `icon` field to answer. `layouts.ts` had read
`card.icon` since cards existed. The pipe was built and the tap was never
opened, which is why widening the icon set alone would have changed nothing
visible.

**#51 — the stage got a ground.** The twelve existing themes are chosen by
_room_ and every one is lit by a single light, which reads as a page. `bloom`
and `mesh` are several offset washes from the theme's own tokens, mixed toward
transparent in OKLab. Four themes use them. The palette test asserted only that
ink and canvas were different _strings_; it now imports `MIN_CONTRAST` from the
health check, so no palette can ship that the app's own report would mark a
deck down for.

### What the reviews cost, and what that says

CodeRabbit found seven real defects across the four. **Three were positions I
had argued for**: that a forged refund's overdraw was bounded to one per
purchase (it is repeatable for the length of a provider call), that best-effort
release of a failed webhook claim was safe because the mutations are idempotent
(that answers double-granting, not the correlated failure), and that a
provider's declared image media type could be trusted into a preview because
the accept path sniffs the bytes later (it does, and by then the generation is
paid for). Each was internally consistent and wrong at the step where money
moves.

Codex ran out of review credits partway through #48 and reviewed nothing after
`639072d`. Four PRs of billing and provider code went out on a single reviewer.
That is worth restoring before the next change to the spend path.

### What Vercel still needs, and what cannot be read from here

Three Stripe price IDs created in this session were never written to the
environment: `STRIPE_PRICE_BASIC_MONTHLY`, `STRIPE_PRICE_PRO_MONTHLY` and
`STRIPE_PRICE_TOPUP`. The paid tiers are visible and not purchasable, which is
the intended degradation rather than a fault — the top-up row is absent from
`/pricing` and the plan controls in settings are hidden. No tool in this
session writes a Vercel environment variable, and the connector's grant covers
only `proficiencyai`. The same blindness covers the model keys: neither
`OPENAI_API_KEY` nor `OPENROUTER_API_KEY` can be read from here, and
`/api/ai/status` reports both but needs a signed-in user. Production has issued
zero image generations ever and no completion has ever run through OpenRouter —
its catalogue endpoints were read while building the client, nothing more.

### The spend boundary, rebuilt and released — PR #48

Shipped to production on 2026-09-01: three tiers (Free, Basic $12, Pro $25), a
$5 top-up for ten presentations, and a reservation that can no longer be talked
out of enforcing any of it.

The headline defect was that `captivate_reserve_generation` took its window and
its ceiling as **arguments**, and PostgREST exposes it to `authenticated` — so
the plan gate in front of it was decoration and any browser could name its own
limit. It now takes a kind and a budget group and nothing else. The hourly
burst ceiling, previously an application read a caller could simply decline to
perform, is decided inside the same lock.

Eight review rounds, each of which found something real. The two that took
longest to get right are worth recording because both of my first answers were
wrong:

- **A forged refund made a credit reusable, not merely double-spendable.**
  Settling runs under the author's own JWT, so "this call failed and produced
  nothing" is a sentence an author can write about their own in-flight
  reservation. I argued the overdraw was bounded to one per purchase; it is
  not, because the forge can be repeated for the whole length of a provider
  call. A credit-backed row now counts regardless of what the caller says about
  it until it is fifteen minutes old, which is longer than any route may run.
- **Best-effort release of a failed webhook claim is not enough.** I reasoned
  it was safe because every mutation is idempotent — which answers
  double-granting and not the correlated failure: the delete and the mutation
  talk to the same database, so the outage that fails the credit insert fails
  the release beside it, and every retry thereafter returns a duplicate 200
  over a customer who paid. `stripe_events.completed_at` makes the claim say
  whether the work finished.

Also in the release: a drawing bounded to its own frame by a real SVG path
parser (arcs measured from the ellipse they sweep, not from their endpoints), a
combobox that does not dismiss the iPad keyboard on every keystroke, and a
sign-in read that retries across the window in which a fresh session is
refused.

**Still unset in Vercel**, so the paid tiers are visible and not yet
purchasable: `STRIPE_PRICE_BASIC_MONTHLY`, `STRIPE_PRICE_PRO_MONTHLY`,
`STRIPE_PRICE_TOPUP`. The degradation is correct rather than broken — the
top-up row is absent from `/pricing` and the plan controls in settings are
hidden — and this session has no tool that writes a Vercel environment
variable.

### Owner-reported defects — PRs #43 and #44

Two rounds from the owner's own use of the deployed build, both root-caused
against production data rather than reasoned about from the code.

**Ten of twenty-one scenes in a generated deck were blank** (#44). The model
had written them; `composeScene` discarded them. `layoutFor` chooses each
scene's layout from its moment's visual intent and the model never sees that
choice, so a layout renders the fields it has slots for and drops the rest in
silence. Nine of the ten were `statement` layouts whose **title** was the
statement — a field no layout draws — which is why the navigator read
perfectly while the canvas was empty. Composition is compose-then-rescue now:
the layout draws what it draws, and only when that comes to nothing does it
reach for a heading it was not given, then fall back to a layout that can hold
what is left. A scene given nothing still composes to nothing, so an empty
scene means the author wrote nothing. The scene prompt also states which
fields each layout draws, which it never had.

**Every dashboard thumbnail could blank at once** (#43). The preview query
discarded its error, so a single post-sign-in 401 — the race `listPresentations`
already documents — served an empty map for the whole page. It retries and
logs now, and a salvaged scene says so.

**The editor was unusable below `md`** (#43, #44). Panels took 484px of width
from a 390px viewport; an anchored popover started at −44px at 320px with
`Undo` entirely off-screen. Both fixed and measured, with a fixture that mounts
the real `Popover` against each window edge.

**PowerPoint export dropped a list's style** (#44) — size, alignment, caps,
weight — while honouring all of it for the paragraph beside it, and flattened
each bullet's runs so a bold word arrived plain.

**The interface wears the mark's colours** (#44): accent is the logo's indigo,
`ai` its magenta, the front door's key light its coral, and `--brand-gradient`
carries the whole sweep. The header names the company — Captivate by Axtevi.
Fixed by accident on the way: the dark theme's `warning` and its accent were
three degrees apart at identical lightness.

Seven review findings came back on #44 from Codex and CodeRabbit; all seven
were real and three were defects introduced by the fix itself. 126 tests added
across the two PRs, each checked by reverting the fix it is about.

Not closed, and not mine to close: most generated scenes want a photograph and
this deployment has no `PEXELS_API_KEY` (free) and no `OPENAI_API_KEY` (paid).
Production has issued **zero** image generations, ever.

### Production-readiness pass — PRs #38–#42

#### PR #38 — discoverability, the signed-in gap, the sign-in outage

Four launch blockers. Three turned out to be the same shape: something built,
deployed and correct that the only client who mattered could not reach.

**The front door could not be found.** `src/app/layout.tsx` carried
`robots: { index: false, follow: false }` for every route, so the landing page,
pricing and sign-up were invisible to search. Indexing is now per route: the
signed-in application, every link-addressed page and both recovery flows opt out
explicitly. `/v/<token>` matters most — a share link is the author's decision
about who sees a deck, and indexing one revokes it silently.

Adding `robots.ts` and `sitemap.ts` exposed the second half: both are generated
routes, so the proxy matcher's static-asset exclusion does not reach them, and
both were answering an anonymous request with a 307 to `/sign-in`. Confirmed
live on production before the fix. `public-paths.ts` already carried a comment
about this exact failure from when the share link was behind the gate; it had
happened again.

**The signed-in app is now under test.** Two earlier attempts died in the
bundler and the cause was never diagnosed, because the error only appears when
the bundle is run alone: rolldown cannot resolve `server-only`, reached through
a `"use server"` module that vite follows and Next replaces. `build.ts` now
stubs those modules the way Next does, reading export names from the real
source. `server-only` is deliberately not aliased away, so a genuine boundary
violation still fails the build. The editor runs with its real store, autosave,
shortcuts and canvas; removing `dirtySections` from `updateSectionLocal` — the
regression that shipped for a release — fails the tests.

**Signing in produced "This page didn't load."** Reported from production while
this pass was open, and root-caused from the edge log rather than guessed at:
`/home` runs four reads concurrently, exactly one came back 401, and there was
no second request for it anywhere. `readTwice` had been retrying the whole time
without making a request — the builder was constructed outside the closure, and
a PostgREST builder is a one-shot thenable, so re-awaiting the settled one
replayed the cached 401. The function's own comment said it took a closure
"because re-awaiting the same object is not a fresh request", and its call site
did exactly that. The query now builds inside the closure, and `readTwice`
compares references and refuses rather than pretending it tried. The test that
was supposed to cover this passed against the defect, because its fake asserted
the opposite semantics in a comment and then behaved that way; it now counts
builders rather than awaits.

**Password policy** was eight characters and nothing else. Now refuses the
common list, its substitution-folded form, repeated characters, key runs, and a
password that is really the email or display name on the same form. Enforced
server-side in both sign-up and recovery.

**A trust surface.** Privacy and terms pages, written from the code — every
processor named is one the application really contacts. Where the product has no
answer, they say so: account deletion is not self-service.

**What review then found**, all of it real against the code and all fixed: the
privacy page claimed Captivate "never sees" a password (the server actions
receive it to check the policy; they do not store it) and described a handout as
a revocable share link (it requires the owner's account and has no token); the
root layout's canonical was inherited by every indexable page, telling a crawler
`/pricing` duplicates the landing page; `robots.txt` disallowed `/settings/` but
not `/settings`; a missing `NEXT_PUBLIC_SITE_URL` would have published
`localhost` URLs into build-time robots and sitemap files; recovery called the
password policy without identity context, so both identity checks silently did
nothing; and `qwertyuiop` cleared the ten-character minimum because a code-point
comparison cannot see a keyboard row. CI then caught the last of it — the smoke
test still demanded the form promise the old eight-character minimum.

#### PR #39 — the account-deletion decision, recorded rather than implied

#### PR #40 — say something when a failure is handled rather than thrown

Captivate returns failures as values, which is right for the caller and
invisible to everyone else. The whole of `src/` held **one** `console.error`
against 77 handled failure sites. That is not theoretical: the sign-in outage
above had to be root-caused from Supabase's edge log, because the application
recorded nothing about the read that failed.

`src/lib/observability.ts` — one function, a greppable prefix, stderr — wired at
three choke points: `fail()` in `data/actions.ts`, `spend()` in `ai/service.ts`,
and the Stripe webhook, including the case that costs real money in silence, a
completed checkout that cannot be attached to an account.

Four review findings, all four real, **three of them mine** — including one I
introduced while fixing another. The public bad-signature path was logging
unbounded (it is now sampled); a double `detailOf` truncated the suppressed
count away, and my test passed only because it used a short string;
`slice(0, 300) + '…'` is 301 characters and my test asserted `≤ 301`, encoding
the off-by-one; and my own round-2 refactor moved `detailOf` outside the guard,
so a malformed error would have thrown from the logger.

#### PR #41 — keep a keyboard inside a modal

`Dialog` trapped Tab by wrapping at either end, which misses the case a person
actually produces: clicking a dialog's own prose leaves focus on `body`, both
branches fall through, and the browser resumes from the clicked node — out of
the panel and into the page the modal covers. Which direction leaks depends on
the layout, and both ship: prose above the last control leaks via Shift+Tab
(`ConfirmDialog`, rename, template), below it via Tab (`ShortcutsDialog`, the
share dialog, the recording detail dialog).

`data-autofocus` had also never worked. Asked for alongside its fallbacks in one
selector list, `querySelector` returns document order, which is always the
header close button — so `ConfirmDialog`'s documented guarantee never to focus
the destructive action held only because the close button is not it.

**The first version of these tests passed against the unfixed code.** They drove
"focus on nothing" with `blur()`, and Chromium resumes from the sequential focus
navigation starting point — which a click moves to the clicked node and a
`blur()` leaves on the element that had focus. The sabotage run caught it; the
tests now click. Review then found that redirecting a Tab to a _chosen_ target
can strand the keyboard on `body` if that target is disabled or unrendered,
which is worse than the escape; both lookups now filter for controls that can
actually take focus.

#### PR #42 — the reserved price is not the caller's to name

A signed-in user could disable AI image generation for every other user of the
deployment with one request. `captivate_reserve_image_generation` took the
per-image estimate, the monthly budget and the daily cap as arguments on a
function `authenticated` can execute, and the monthly sum has no owner filter
because the ceiling belongs to the deployment. So `p_estimate_usd: 500` wrote
500 into a budget shared by everybody and refused everyone else for the rest of
the month — no model call, no real money, and a free account could do it,
because the Pro gate is applied in the application rather than in the function.

`0020` had closed the settlement end of exactly this threat; this closes the
reservation end, which was the cheaper attack. It was never used: production
holds **zero** `ai_generations` rows of kind `image` — not this month, not
ever — so the shared budget is untouched, there is no poisoned `cost_usd` row
to reverse, and the migration lands on an empty ledger. Checked rather than
assumed, because "nobody exploited it" is the kind of claim that is worth a
query. The three numbers move into
`public.ai_image_limits`, RLS on with no policies, read inside the locked
statement that checks them.

The RLS harness caught two things review would not have: Supabase's default
privileges re-granted `anon` EXECUTE on the recreated function, and an existing
probe asserting `count(*) = 0` was passing only because Bob owned no rows.

Ten review findings were raised on this PR and every one of them was real;
three were about claims rather than code, which is the failure this session
kept repeating. The last of them is worth recording because it changed
the fix rather than the prose: the ceilings were read _before_ the budget lock
was taken, so a queue of callers each held the numbers from before an operator
lowered them and was then admitted one at a time against a budget that no
longer existed — the lock guarding the measurement while leaving the decision
unguarded. `supabase/tests/ceiling_race.sh` holds eight callers inside the
function while the budget is lowered to zero and asserts all eight are refused;
against the previous ordering it reports `tickets_issued=8`. The documented
operator update in `docs/DEPLOYMENT.md` now takes the same lock, so the
boundary holds from the writer's side too.

### Verification

- `npm run verify` green with no warnings: **1023 unit/component tests across 74
  files**.
- Playwright: 37 smoke, 41 lifecycle, 5 shader.
- `migrations:check` against a database with every migration applied: all 36
  required objects present, including `public.ai_image_limits` and the new
  two-argument signature.
- `npm run test:rls` green including both concurrency harnesses — the
  reservation race and the new ceiling race — and all 13 `image_*` probes. Both
  were re-run against the defect they describe and both fail there.
- Production re-verified independently: the supersession rule is present in the
  deployed function, `captivate_settle_image_generation` is the five-argument
  form, no spend function is anon-reachable, no owner-scoped table is missing
  RLS, and nothing in `schema_required.sql` is absent. No migration drift.
- `robots.txt`, `sitemap.xml`, per-route `noindex`, all six canonicals and the
  legal pages confirmed in rendered output from a built server rather than from
  source — including a build made with `NEXT_PUBLIC_SITE_URL` cleared and only
  Vercel's production URL set, to prove that fallback survives static
  prerendering.
- Every new assertion was run against its own defect before being trusted: the
  retry test fails three of five cases, the recovery test two of three,
  `qwertyuiop` is accepted, and the robots, canonical and origin tests each
  fail.

## Blockers

- None for engineering. One owner-only production setting is wrong and is
  listed first under standing owner actions.

## Standing owner actions

0. **Set Supabase Auth's URL configuration for production** — Authentication
   → URL Configuration: Site URL `https://www.axtevi.com`, and
   `https://www.axtevi.com/auth/callback` under Redirect URLs. Until then every
   confirmation and password-reset email points at `http://localhost:3000`.
   Read from the emails themselves on 2026-09-02, not inferred.
1. Set the Stripe account's public business name to **Axtevi** — it appears on
   card statements, receipts and the Billing Portal.
2. Confirm `STRIPE_WEBHOOK_SECRET` matches the mode of `STRIPE_SECRET_KEY`.
   Test and live endpoints have different secrets, and a mismatch fails every
   delivery while everything else looks correct.
3. Delete the two disposable `webhook-probe@example.com` Stripe customers left
   by the end-to-end proof (tagged `delete_me`).
4. **Enable leaked-password protection** — Supabase dashboard, Auth → Policies.
   It checks new passwords against HaveIBeenPwned and costs nothing. There is no
   MCP tool and no management token in the agent environment, so it cannot be
   set from here. The application-level policy in `src/lib/auth/password.ts`
   narrows the gap but does not replace a breach corpus.
5. **Set `NEXT_PUBLIC_SUPPORT_EMAIL`** in Vercel. Until it is set, the privacy
   and terms pages say to contact whoever runs the deployment rather than print
   an address nobody reads.
6. **Review the privacy and terms wording.** The facts in both are derived from
   the code and are accurate; the wording has had no legal review.

`PEXELS_API_KEY` and an image key are both configured, and neither is an owner
action any more — read back on 2026-09-02 from a signed-in production session,
where the picker offered a Find tab (which renders only when the stock key
resolves) and a Generate tab (only when an image key does), and a picture came
back. `PROJECT_CHECKLIST.md` says the same; the two agreed once this session
finished rather than one describing the other's world. The paragraph that
follows is what the evidence said before that, kept because it is how the gap
was found: `ai_generations` holds **zero** rows of kind `image`
for the life of the deployment, which is decisive for the generated path — a
call would have written one. Stock photography leaves no row, so it is
inferred rather than read: a twenty-one-scene deck generated on 2026-09-01 came
back with two pictures, both staged drawings, while several split scenes
carried an `imagePrompt` and an empty slot the dress pass would have filled.
Both keys are listed as owner actions in `PROJECT_CHECKLIST.md`.

## Recommended Next Steps

0. **`BETA-006`: durable, resumable `create-from-map` generation.** Owner-scoped
   next high-priority reliability item, not yet started. `create-from-map`
   still runs as one long synchronous request with no persisted job, no
   idempotency key, and no per-scene resumability — see "An honest error
   message, and the durability gap it was standing in for" above for the
   incident that surfaced it and the full acceptance criteria in
   `PROJECT_CHECKLIST.md`.
1. **Account deletion.** Not self-service, and the privacy page says so. Doing
   it properly means cascading through presentations, scenes, assets,
   recordings, storage objects and the Stripe subscription; doing it badly
   leaves orphaned files and a live subscription, which is why it was recorded
   rather than rushed into a release pass.
2. **A hosted authenticated journey — and it does not need the owner.**
   Signed-in _components_ are covered; a signed-in _session_ is not. Both routes
   out of this environment are closed, and that was established rather than
   assumed: production `mailer_autoconfirm` is `false`, so a synthetic sign-up
   needs a mailbox nothing here can read, and there is no Docker daemon in the
   agent container for a local Supabase stack. Neither is an owner decision. The
   route that needs no credentials at all is a CI job that runs the Supabase
   stack locally in GitHub Actions — where Docker does exist — seeds a confirmed
   synthetic user, and runs the `authenticated` Playwright project against it.
   That is engineering work rather than an owner action, and it closes the
   signed-in-_session_ gap. It does not close BETA-001 as written, which asks
   for authenticated journeys against the exact hosted Preview candidate — a
   local stack is a different environment, and calling it the same thing is how
   a gate gets marked done without the evidence it names.
3. **`codex/economical-ci-20260831`** carries five unmerged commits that select
   CI checks by changed-file risk. Worth a decision: it trades hosted-CI cost
   against coverage, and that is a judgement about how much protection to keep,
   not a defect to fix.
4. **Stale branches.** Nineteen are fully merged with no unique commits and are
   safe to delete, but this environment's git proxy refuses a delete refspec
   (HTTP 403), so they remain. Enabling "automatically delete head branches" on
   the repository would stop them accumulating.
5. `docs/ROADMAP.md` holds what has been asked for and not built: audience
   feedback (polls, trivia, Q&A), integrations with confidence monitors and
   Descript, keeping a reference file as stored evidence, and PDF reading.

## Pricing, the reservation boundary, and what a presentation costs

The pricing change grew into a rebuild of the spend boundary, because working
out what a tier should allow surfaced two holes and one gap that made the
question unanswerable.

**The ceilings were the caller's to name.** `captivate_reserve_generation` took
its window and its ceiling as arguments, and PostgREST exposes it to
`authenticated` — so nothing on the wire distinguished the server's call from
the same RPC issued from a browser with a ceiling of its own. The plan gate in
front of it was decoration. This is the hole `0021_reservation_ceilings.sql` had
already closed for image generation; the text reservation was left with the same
shape. It now takes a kind and a budget group, resolves the plan itself, reads
its own ceilings, and refuses a kind recorded against a group it does not draw
on.

**The hourly burst ceiling was never enforced.** It existed as a number in a
table and as an application read before the reservation — a read a caller can
decline to perform, and one two simultaneous callers both pass. Both ceilings
are now decided inside the lock the function already took.
`supabase/tests/reservation_race.sh` races each of them: sixteen simultaneous
callers with one place left get exactly one ticket. Against a build with the
burst check outside the lock, eight of sixteen get through — checked rather than
assumed.

**Nothing knew what a generation cost.** `ai_generations` has recorded tokens
and a `cost_usd` since the ledger was built, and for every text call that column
was zero: only image generation ever wrote it. So the allowances had to be
argued from a sample of five presentations. `ai_model_rates` now prices every
settled row at the rate in force when the call was made — including truncations,
schema failures and corrective retries, because the provider reports usage on
those and the money is spent whether or not the author got anything.

**Allowances are 10, 25 and 60 presentations** in any rolling 30 days, and every
other pool is that number times what one presentation can take from it. The
coupled pools were a real defect: Basic was sixty decks and sixty drawings, so
an author who used their allowance could illustrate one presentation in every
one they generated.

**A top-up buys presentations, not a deck counter.** Ten credits raise every
coupled pool by a presentation's worth, and one is spent when a deck is actually
made. The acceptance test exhausts every allowance, buys a top-up, and asserts
ten complete presentations come out — ten decks, ten maps, a hundred drawings —
with the eleventh refused.

What is _left_ of a purchase is counted from the ledger rather than kept as a
number, which is the second thing review found here. A stored remainder was
reachable: settling is done by the caller under their own JWT and a pending row
may be written again, so an author could settle their own in-flight generation
as a zero-token failure, take the refund, spend it, and let the truthful
settlement land afterwards — repeatably, from one purchase. Counting removes
the window rather than narrowing it, and the plan's own allowance is counted
separately from what credits paid for, so an allowance still renews while a
balance is spent.

**Annual billing is withdrawn rather than hidden.** There is no code path that
opens an annual checkout; the annual price ids are read only so a subscription
bought earlier still resolves to the tier its holder paid for. Re-enabling it
is gated on measured cost per presentation, which the ledger can now answer.

### The signed-in journeys now run themselves

For most of this project the signed-in half of the product was proved by hand:
the `authenticated` Playwright project needed an account, and neither a hosted
sign-up nor a local Supabase stack was reachable from the agent's container. It
runs in CI now — the job starts a Supabase stack, applies every migration, seeds
its own synthetic account from the stack's own freshly minted service key, builds
against it and drives twenty-seven journeys through a real browser. Nothing is
stored: the account exists for the life of the job.

Running them for the first time is what running them is for. Four defects came
out of it, and only one was in the tests:

- **Undo history vanished mid-edit.** `EditorRoot` re-initialised the store on
  any re-render that handed down a new `document` object, and `init` clears
  `past` and `future`. Several server actions call `revalidatePath("/edit/:id")`,
  which does exactly that — so an author's undo stack disappeared for no reason
  they could see. Keyed on the deck's id now, with the regression covered in
  `tests/unit/editor-history-persistence.test.tsx`.
- **A journey helper drove the wrong template.** It clicked the first card on
  the gallery, which is the worked example, while the movement-rail test asserts
  the lecture's movements. It takes the template's name now.
- **The camera flight was asserted by two samples across a CDP round-trip**,
  which says more about scheduling than about the camera. The journey records
  every transform the world writes and asserts it passed through the middle;
  `tests/e2e/camera-flight.spec.ts` pins the same property with no server and no
  account, and uses `travel: "cut"` as its control.
- **A deployment-configuration check ran against a throwaway container.** The
  imagery check asks a deployment whether it has a model key; CI's stack has none
  by design. It runs where the question exists.

The RLS suite also moved to the Postgres major production actually runs (17),
and the job now fails if the image and `supabase/config.toml` disagree.

### Closed on 2026-09-02

- **Generated imagery is proven in production.** The ledger holds one succeeded
  `image` generation — `gpt-image-2`, 41.7 s, $0.05, on a real presentation, by
  a `pro`-granted account — the deployment's first. The unprefixed model id
  matches the OpenAI gateway's default naming, which is consistent with
  OpenAI serving it and not proof: the ledger keeps the model string, not
  the gateway, and a `CAPTIVATE_IMAGE_MODEL` override would record the same
  value through OpenRouter. Before this, the promise on the
  pricing page was backed by no completed generation at all, and the failure
  was honest everywhere an author looked — the picker hid the tab, the service
  said so — which is exactly why it could have stayed absent unnoticed.
- **A ledger row now names the gateway that was paid.** The row above could
  say `gpt-image-2` and nothing about who served it, because settlement kept
  the model string alone and a `CAPTIVATE_IMAGE_MODEL` override records the
  same string through either gateway. `0028` adds `ai_generations.provider`,
  constrained to the three gateways the application can be built against,
  and both settlement functions take it as a defaulted final argument — so
  the build running when the migration was applied kept settling, with the
  gateway unrecorded, until it was rebuilt. Text settlement passes the
  resolved `AI_PROVIDER`, image settlement `IMAGE_PROVIDER`; an unknown value
  is refused and leaves the row pending for the retry rather than written
  half-true. Nothing is backfilled: a row settled before the column existed
  has no honest answer, and stamping the current environment onto it would be
  the cross-reference the column exists to end. Applied to production on
  2026-09-02 ahead of the deploy and read back — new signatures present, old
  ones gone, `authenticated` may execute and `anon` may not.

### Closed on 2026-09-03

- **Keeping a generated image works on production.** The journey
  `a paid account can generate an image and keep it` ran against
  `https://www.axtevi.com` after PR #60 deployed: generated, kept, saved, and
  the picture decoded at 1536x1024 after a full reload. The `assets` row it
  left carried `source = 'generated'`, `provider = 'openai'`, the MIME type
  read out of the bytes rather than declared, and the real byte count.
- **Which gateway serves production's images is settled, not inferred.** That
  row's `provider` column records the resolved `IMAGE_PROVIDER`, not a model
  string, and it reads `openai`. The OpenRouter account's exhausted balance
  cannot affect an image any user generates.
- **The disposable production identity is removed**, storage objects included.

### Found by reading Stripe rather than the code

**Billing readiness was marked done on half a proof.** PROD-007 said the
subscription loop was proven end to end with a live subscription, and a live
subscription does exist in the account's history — one, `e2e_webhook_probe`,
tagged `delete_me`, cancelled the same minute it was made. What it was not is
a purchase: it was created through the API, and the live account has **zero
Checkout Sessions in its entire history**. So what that proof covers is
everything after the sale — webhook, signature, mirrored row, entitlement —
and nothing before it. The item now says so and is no longer DONE.

The distinction matters because the two halves fail independently and the
checklist is a release gate. A reader taking "billing readiness: DONE" at face
value would conclude a customer can buy, and no customer can.

**There is no Customer Portal configuration on the Stripe account** — none in
live mode and none in test. Stripe refuses to open a portal session until one
is saved, so "Manage billing" in `/settings` would fail for the first person
who ever subscribes: the one control a paying customer needs to cancel, change
a card, or move tier. Nothing caught it because nothing has subscribed yet —
the journeys reach that button only on an account with a real subscription,
and the checkout that would create one is itself refused. Two gaps hiding
each other is the ordinary shape of this: each looks like the other's
precondition until somebody reads the account.

It is a settings decision with money attached — what a customer may do to
their own subscription without asking — so it is recorded as an owner action
rather than defaulted by the agent.

### Still open

1. **Why Stripe refuses the checkout — narrowed to one unreadable line.**
   Production answers "Stripe rejected that request", which rules out the case
   with its own sentence — a price Stripe does not recognise — and leaves an
   invalid-request refusal of the session itself. On 2026-09-03 every input to
   that call was read back and every one is valid: the live account has
   `charges_enabled`, `payouts_enabled` and `details_submitted` all true, no
   requirement currently or past due, no `disabled_reason`, and active card
   payments; the customer exists in live mode on that account; both prices are
   recurring, active and on active products; and the success and cancel URLs
   are absolute, which production's own `robots.txt`, sitemap and canonical tag
   confirm by publishing `https://www.axtevi.com` out of the same variable.

   So **account activation is not the blocker**, which is what this record said
   for two days on the strength of it being the usual one. What remains is the
   message Stripe itself returned. The deployment logs it at the choke point,
   and Stripe keeps its own copy under Developers → Logs; both need a console
   this environment has no grant for — the Vercel connector's projects were
   listed again on 2026-09-03 and Captivate is still not among them.

   Reading one line in either console settles it, and nothing else can.

2. **The Supabase Auth URL configuration** — see standing owner actions. It is
   the one defect found this session that no code change can fix.
