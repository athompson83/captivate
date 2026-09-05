# Features

Status is stated plainly. **Implemented** means built, working and exercised by
a test. **Partial** means usable but narrower than the label suggests.
**Deferred** means deliberately not built for this MVP.

---

## Accounts

| Feature                    | Status      | Notes                                            |
| -------------------------- | ----------- | ------------------------------------------------ |
| Sign up, sign in, sign out | Implemented | Email and password                               |
| Password recovery          | Implemented | Email link → `/update-password`                  |
| Session persistence        | Implemented | Refreshed in the proxy layer on every navigation |
| Profile and display name   | Implemented | Created automatically by a database trigger      |
| Interface theme preference | Implemented | System, light or dark                            |
| OAuth providers            | Deferred    | Email is enough for an MVP                       |

Sign-in errors are deliberately generic: distinguishing "no such user" from
"wrong password" would let anyone enumerate registered addresses.

---

## Presentations

| Feature                       | Status      | Notes                                                  |
| ----------------------------- | ----------- | ------------------------------------------------------ |
| Create, rename, duplicate     | Implemented | Duplicate copies sections and scenes with remapped ids |
| Delete and restore            | Implemented | Soft delete; "Recently deleted" with permanent purge   |
| Autosave with visible state   | Implemented | Saving / Saved / Couldn't save, with last-saved time   |
| Open, reopen, survive restart | Implemented | Covered by an end-to-end test                          |
| Live thumbnails               | Implemented | Rendered by the real stage engine, so never stale      |
| Search                        | Implemented | Titles, descriptions and note bodies                   |
| Folders, tags, favourites     | Implemented | Filters live in the URL, so a view is shareable        |
| Sort                          | Implemented | Last edited, last opened, created, title               |

---

## Creating

| Path                         | Status      | Notes                                    |
| ---------------------------- | ----------- | ---------------------------------------- |
| From a template              | Implemented | Six curated structures                   |
| Blank                        | Implemented | One title scene, not an empty void       |
| With AI                      | Implemented | Prompt → editable narrative map → scenes |
| From an existing deck        | Implemented | Duplicate                                |
| Import PowerPoint or Keynote | Deferred    |                                          |

---

## Editor

| Feature                                | Status      | Notes                                                                                            |
| -------------------------------------- | ----------- | ------------------------------------------------------------------------------------------------ |
| Add, delete, duplicate, reorder scenes | Implemented | Drag to reorder                                                                                  |
| Insert between scenes                  | Implemented | Hover affordance in the gap, plus a scene menu                                                   |
| Sections                               | Implemented | Add, rename, delete, reorder; deleting keeps the scenes                                          |
| Undo and redo                          | Implemented | Typing coalesces into one entry per burst                                                        |
| Copy, cut, paste, duplicate            | Implemented | In-memory clipboard, no permission prompt                                                        |
| Multi-select                           | Implemented | Shift-click and marquee                                                                          |
| Drag and resize                        | Implemented | Eight handles; shift preserves aspect                                                            |
| Snapping and guides                    | Implemented | Safe area, stage centre, other elements' edges; Alt suspends                                     |
| Align and distribute                   | Implemented | A single selection aligns to the safe area                                                       |
| Z-order, lock, hide                    | Implemented |                                                                                                  |
| Inline text editing                    | Implemented | Plain-text only, so pasted markup cannot enter the document                                      |
| Contextual inspector                   | Implemented | Appears only with a selection                                                                    |
| Layout picker                          | Implemented | Re-flows content into a designed composition, keeping the text                                   |
| Undo and redo                          | Implemented | Coalesced history; a labelled group in the header at every width                                 |
| Show-wide backdrop                     | Implemented | One picture behind the whole show, on a plane at a chosen distance so flights move it with depth |
| Keyboard shortcuts                     | Implemented | Listed in Settings and in the editor                                                             |
| Real-time collaboration                | Deferred    | The schema does not preclude it                                                                  |

### Elements

Implemented: heading, text, quote, list, image, video, audio, shape, divider,
icon, callout, code, chart, embed.

Charts are a dependency-free renderer covering bar, column, line and donut, with
a required text description for screen readers. Embeds are sandboxed iframes
restricted to http and https.

---

## Media

| Feature                         | Status      | Notes                                                                                                           |
| ------------------------------- | ----------- | --------------------------------------------------------------------------------------------------------------- |
| Upload images, audio, video     | Implemented | Direct to storage, so no function body limit                                                                    |
| Drag and drop                   | Implemented | Anywhere on the assets page, or into the picker                                                                 |
| MIME and size validation        | Implemented | Client and server, plus a bucket-level allowlist                                                                |
| Media library and reuse         | Implemented | Filter by type; reuse across presentations                                                                      |
| Alt text                        | Implemented | Prominent, with a count of images still missing it                                                              |
| Fit, focal point, scrim, radius | Implemented | Drag the focal point directly                                                                                   |
| Replace media                   | Implemented | Upload, library or URL                                                                                          |
| Cropping beyond focal point     | Partial     | Focal point and fit only; no free crop                                                                          |
| AI image generation             | Implemented | Paid plans only, from the picker's Generate tab; the first real picture came back from production on 2026-09-02 |

---

## Themes and layout

Six themes — Midnight, Paper, Clinical, Signal, Ember, Chalk — as token sets, so
re-theming never rewrites element content. Eighteen named layouts own their
geometry, which is what keeps generated and hand-edited scenes composed — four
of them (take-home, call to action, one number, explainer) are points rather
than pages, drawn as icon-led open callouts with no panel behind them, and the
generator routes a movement's last beat, an application, a close and a
context moment to them.

Text auto-fit shrinks over-long text so it cannot spill onto the element below.

Scene-level background overrides are implemented, and behave differently in the
two places a scene is drawn. On the editor canvas or in a thumbnail — where a
scene is a discrete object — the background is painted. On the world canvas a
colour becomes **atmosphere**: its palette is blended into the air around that
region rather than drawn as a panel, because a panel is an edge and an edge is a
slide. An image background is still drawn there, feathered at the rim.

Full per-scene theme overrides are **partial**: the field exists, is stored, and
already drives the region's atmosphere, but no UI exposes it yet.

---

## Motion

Nine entrance presets, four emphasis options, per-element
delay and duration, build-on-advance, and staggered lists. All respect
`prefers-reduced-motion`. A full timeline editor is **deferred** — reliable
transitions first.

---

## Notes

| Feature                    | Status      | Notes                                                         |
| -------------------------- | ----------- | ------------------------------------------------------------- |
| Per-scene speaker notes    | Implemented | Private; shown in the console only                            |
| AI-drafted speaker notes   | Implemented | Reads the scene from the database, not from the request       |
| Lecture notes              | Implemented | Separate table, full-page workspace, up to 500,000 characters |
| Attach a note to a scene   | Implemented | Surfaces in the console on that scene                         |
| Search notes               | Implemented | In the workspace and in the command palette                   |
| Rehearsal timing per scene | Implemented | Drives the console's pacing indicator                         |

---

## Presenting

| Feature                            | Status      | Notes                                                               |
| ---------------------------------- | ----------- | ------------------------------------------------------------------- |
| Full-screen stage                  | Implemented | Fullscreen API, with an honest message when refused                 |
| No editor chrome                   | Implemented | A separate route, asserted by a test                                |
| Keyboard and click navigation      | Implemented | Arrows, space, page keys, digits; click right/left thirds           |
| Element builds and staggered lists | Implemented | Advance walks builds before changing scene                          |
| Camera travel                      | Implemented | Fly, dissolve or cut — set once for the whole presentation          |
| Spatial arrangements               | Implemented | Flow (default), reel, grid, timeline, spiral, dive, constellation   |
| Continuous surface                 | Implemented | Scenes are regions with no edge, not cards                          |
| Movements                          | Implemented | Named stretches of the argument, shown to the audience on a rail    |
| Next-movement signpost             | Implemented | Names what follows as a movement ends                               |
| Presentation health                | Implemented | Six checks over the real document, with the fix for each            |
| Pacing strip                       | Implemented | Time per movement, estimated from content where untimed             |
| Accented claim                     | Implemented | The clause a heading turns on carries the theme accent              |
| Atmosphere                         | Implemented | Per-pixel colour field in WebGL, blended from the regions around it |
| Journey map                        | Implemented | Drag scenes in world space; drop one inside another to nest it      |
| Overview                           | Implemented | `O` pulls back over the whole world and draws the route             |
| Scene jumper                       | Implemented | Searches titles _and_ on-scene text                                 |
| Blank the screen                   | Implemented | `B`; any advance restores it                                        |
| Wake lock                          | Implemented | Where the browser supports it                                       |
| Progress indicator                 | Implemented | A hairline the audience reads as pacing                             |

### Presenter console

Current scene as a live control pad, next-scene preview, speaker and lecture
notes with adjustable text size, total and per-scene timers with rehearsal
targets and over-time warning, pause and reset, a scene filmstrip, connection
status, and recording status. All **implemented**.

With no stage window connected the console drives itself, so rehearsal works
without a second display.

### Annotation

Laser pointer, drag-to-highlight, freehand ink in five colours and three
weights, eraser, clear-scene, clear-all. All **implemented**, all session-only —
none of it modifies the saved presentation.

Drawing works on the stage directly (single screen) or on the console's control
pad (dual screen), because coordinates are normalised.

### Multi-display

**Partial, by choice.** The Window Management API is not available in enough
browsers to depend on. Captivate uses two same-origin windows over
BroadcastChannel, which works everywhere, and tells the user to drag the stage
window to the projector — one instruction, no experimental API.

---

## Recording

| Feature                          | Status      | Notes                                                           |
| -------------------------------- | ----------- | --------------------------------------------------------------- |
| Screen capture                   | Implemented | `getDisplayMedia`; the user picks the tab                       |
| Microphone with device selection | Implemented | Echo cancellation and noise suppression on                      |
| Camera picture-in-picture        | Implemented | Composited onto a canvas, so it is _in_ the file                |
| Camera corner, size, shape       | Implemented | Four corners, three sizes, circle or rounded                    |
| Pause and resume                 | Implemented | Where `MediaRecorder.pause` exists                              |
| Scene timeline                   | Implemented | Becomes chapter markers in playback                             |
| Local download                   | Implemented | Offered the instant recording stops, before any upload          |
| Upload to library                | Implemented | Private bucket; playback through a signed URL                   |
| Honest failure                   | Implemented | A failed upload is marked `local_only` and says so              |
| Format                           | Implemented | Negotiated against the browser: MP4 on Safari, WebM on Chromium |
| Server-side transcoding          | Deferred    | Would need a paid worker; the download is the practical path    |
| Trimming and editing             | Deferred    |                                                                 |

Annotations, camera flights and video all appear in the recording, because the
capture is of the rendered tab.

See [RECORDING.md](RECORDING.md) for what browsers genuinely cannot do.

---

## AI

| Capability                                                    | Status                                                      |
| ------------------------------------------------------------- | ----------------------------------------------------------- |
| Prompt → editable narrative map                               | Implemented                                                 |
| Narrative map → full presentation                             | Implemented                                                 |
| Regenerate scenes from an edited map                          | Implemented                                                 |
| Rewrite one moment, leaving the rest of the map alone         | Implemented                                                 |
| Ground a moment in an asset or lecture note                   | Implemented — by reference only; invented ids are dropped   |
| Lock a moment against regeneration                            | Implemented                                                 |
| Generate a single scene                                       | Implemented                                                 |
| Speaker notes: draft and improve                              | Implemented                                                 |
| Rewrite, shorten, expand, simplify, change tone, alternatives | Implemented                                                 |
| Suggest visuals                                               | Implemented                                                 |
| Improve flow, suggest transitions                             | Partial — schema and prompts exist; no UI surfaces them yet |
| Generate images                                               | Deferred — cost                                             |

Without an API key, AI routes report "not configured" and a deterministic
generator produces an editable structural draft, labelled as exactly that.

---

## Built since this list was written

Three things below were once on it and are not any more, which is worth saying
plainly rather than quietly deleting:

- **Sharing links** — `/v/[token]`, a capability token resolved by a database
  function that never selects presenter material.
- **Speaker-view on a phone** — `/present/[id]/remote`, joined to a live
  session over a gated Realtime channel.
- **PowerPoint export** — a `.pptx` Keynote also opens, written in the browser.
  Export only; there is no importer.

## Deliberately not built

Real-time collaboration · comments · public publishing · version history beyond
undo · enterprise team management · brand management · a template marketplace ·
PowerPoint _import_ · analytics · offline mode.

Every one of these is a reasonable thing to want. None is needed to stand up and
give a lecture, which is what this MVP is for.

## Wanted next

`docs/ROADMAP.md` covers what has been asked for and not yet built — audience
feedback (polls, trivia, Q&A), integrations with confidence monitors and
Descript, generation grounded in a reference file, and more templates and
themes — with the shape each would take.
