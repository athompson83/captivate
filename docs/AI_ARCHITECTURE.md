# AI architecture

## The rule

**The model never returns presentation state.** It returns _content_, in a
schema with tight limits, which the application then pours into the layout
engine.

Two consequences, both deliberate:

Composition quality stays under the application's control. A model asked to
produce coordinates produces plausible-looking coordinates that overlap.

And the schema limits — 120-character headings, at most six bullets of 140
characters — _structurally_ prevent the dense scenes generated decks are
notorious for. The model cannot produce a wall of text because the schema will
not hold one. This is enforcement, not prompting.

---

## The one door

Every model call goes through `generateStructured` in `lib/ai/provider.ts`:

1. Derive a JSON Schema from a Zod schema (`z.toJSONSchema`).
2. Force a tool call with `tool_choice: { type: "tool", name }` — so there is no
   free-text parsing anywhere in the codebase.
3. Validate the tool input against the same Zod schema.
4. On failure, retry **once**, feeding the specific validation errors back so
   the model can correct a near-miss.
5. On second failure, return a typed error. Nothing is applied.
6. Report token usage, which is written to `ai_generations`.

Swapping providers means reimplementing that one function.

---

## Capabilities

| Route                     | Schema               | Notes                                                  |
| ------------------------- | -------------------- | ------------------------------------------------------ |
| `/api/ai/map`             | `ProposedMap`        | The argument. Nothing is created yet                   |
| `/api/ai/create-from-map` | `GeneratedScenes`    | An accepted map → a presentation, map stored first     |
| `/api/ai/scenes-from-map` | `GeneratedScenes`    | Regenerates scenes for an existing presentation's map  |
| `/api/ai/moment`          | `RewrittenMoment`    | Rewrites one beat. Nothing else in the map is touched  |
| `/api/ai/evidence`        | —                    | What this user can ground a claim in, read server-side |
| `/api/ai/scene`           | `GeneratedScene`     | One scene, inserted where the user chooses             |
| `/api/ai/rewrite`         | `RewriteResult`      | Rewrite, shorten, expand, simplify, tone, alternatives |
| `/api/ai/notes`           | `SpeakerNotesResult` | Reads the scene from the database, not the request     |
| `/api/ai/visuals`         | `VisualSuggestion`   | Describes what a picture should show                   |
| `/api/ai/status`          | —                    | Whether a model is configured, so the UI can be honest |

---

## Map first

The AI path stops at a **narrative map** — what each movement and moment has to
accomplish — which the user reads, edits and regenerates before a single scene
exists. It replaced a flat title/purpose/layout outline, and the difference is
not cosmetic: every moment must state why it exists and what the audience
leaves with, and `ProposedMoment` refuses an empty one. A beat that cannot say
what it is for is not a beat.

Reviewing an argument takes a minute. Discovering a bad argument after forty
scenes have been written costs far more, in tokens and in the user's patience.
The map is also where the user picks the theme.

Unlike the outline, the map is **not thrown away after generation**. It is
stored, it is what scenes are generated from, and it is a first-class editor
view the author comes back to. Regenerating a presentation regenerates it from
the map rather than from the prompt.

Three things the application owns and never delegates to a prompt:

- **Ids.** A proposal has none. `draftFromProposal` assigns them, and a
  regeneration merges into the existing map by reusing a movement's id where
  its short label is unchanged — so scenes filed under it survive.
- **Evidence.** A model may only cite ids from a list read server-side from
  what the user actually owns. Anything else is dropped and the count of what
  was dropped is reported. This is what stops a fabricated citation entering
  the document by way of a plausible-looking id.
- **Time.** Proposals carry weights, not seconds. `distributeSeconds`
  distributes the requested running time across them twice — movements, then
  moments within each — so a template's proportions hold at any length and the
  totals add up exactly.

`/api/ai/create-from-map` writes the map before it writes any scene, so a
failed generation leaves an author with their argument intact and a map view to
generate from — rather than nothing.

---

## Composition

`materialise()` turns validated model content into a scene:

```
GeneratedScene → LayoutContent → composeScene(layout, content) → SceneContent
```

The model chooses a layout from a fixed set (`custom` is deliberately excluded —
the generator must choose a designed composition, not position by hand) and
fills only the fields that layout uses. Everything else is empty.

Where the model asks for an image via `imagePrompt`, a placeholder image element
is created in the right slot with the prompt as its alt text. The composition is
correct; the user only has to drop a picture in.

---

## Cost control

- Rate limited per user per rolling hour: 30 heavy generations, 200 light ones.
  Counted from `ai_generations` rows, because serverless makes in-memory
  counters close to meaningless.
- Output capped at 8,000 tokens.
- Editing existing structured output is preferred over regenerating.
- **No image generation.** Captivate describes what a picture should show and
  offers the description as a search or commission prompt. Generating images
  costs real money and never happens without an explicit, informed action.

---

## Failure

Nothing is destroyed when generation fails. Failures are typed:

| Reason           | Behaviour                                          |
| ---------------- | -------------------------------------------------- |
| `not_configured` | UI says so; the deterministic generator takes over |
| `invalid_output` | Retried once; then reported, nothing applied       |
| `overloaded`     | "Try again in a moment — nothing was changed"      |
| `provider_error` | Reported with the underlying message               |

Text tools present results as _proposals_. The user picks one, and undo reverses
it like any other edit. AI that silently rewrites your slide creates cleanup;
AI that offers three options saves work.

### The connection is a failure mode too

Writing a full deck is one model call of ninety seconds or more, and a route
that says nothing until it is done loses the phone before it is: iOS drops a
request that has received no bytes for sixty seconds and reports a network
failure while, on the server, the deck finishes and is saved. Every route
allowed to run past a minute — `map`, `create-from-map`, `scenes-from-map`,
`visuals/draw`, `visuals/generate` — therefore answers through
`lib/ai/keep-alive.ts`: the headers go out at once, a newline of JSON
whitespace follows every ten seconds, and the route's own JSON is the last
thing written. The body is still one JSON value, so the client reads it with
`response.json()` as before. What the wrapper gives up is the status code — a
streamed response is 200 before the outcome is known — so a long route's
failure travels as the `error` field of the body, and every AI client treats
that field as failure whatever the status. The checks that produce a real
status (signed out, rate limited, malformed input) run before the wrapper and
keep theirs. `tests/unit/long-route-keep-alive.test.ts` reads the routes and
fails on any `maxDuration` past sixty seconds that does not return this way.

The heartbeats also have to reach the device. The wrapper's first release sent
them and the phone still timed out over a map the server finished in 58
seconds, because the JSON body was compressed on its way out and a newline
sat in the compressor's window instead of being forwarded. The response now
declares `Content-Encoding: identity`, which a compressing hop honours by
leaving the body alone, so each heartbeat arrives when it is written.

---

## Without a model

`lib/ai/fallback.ts` produces an editable structural draft, and the UI says
exactly that — "No language model is configured on this deployment, so Captivate
built a structural draft instead."

It derives a real title (stripping framing verbs, format phrases and the article
that belonged to them, so "A 50-minute lecture on recognising shock" yields
"Recognising shock") and uses a narrative skeleton — _Why this matters_, _What
to look for_, _Common mistakes_ — rather than keywords lifted from the prompt,
which produced fragments like "Appear".

Every scene is a real composed scene that satisfies the same schema, so the
create path is never a dead end. It is not presented as AI-written content,
because it isn't.

---

## Audit

Every call writes an `ai_generations` row: kind, prompt, status, model, token
counts, error, timestamps. That is what makes spend visible, and it doubles as
the rate limiter's counter. Rows are immutable from a client — there is a SELECT
and an INSERT policy, and deliberately no UPDATE or DELETE.
