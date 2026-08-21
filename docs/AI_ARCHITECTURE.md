# AI architecture

## The rule

**The model never returns presentation state.** It returns *content*, in a
schema with tight limits, which the application then pours into the layout
engine.

Two consequences, both deliberate:

Composition quality stays under the application's control. A model asked to
produce coordinates produces plausible-looking coordinates that overlap.

And the schema limits — 120-character headings, at most six bullets of 140
characters — *structurally* prevent the dense scenes generated decks are
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

| Route | Schema | Notes |
| --- | --- | --- |
| `/api/ai/outline` | `PresentationOutline` | Structure only. Nothing is created yet |
| `/api/ai/generate` | `GeneratedScenes` | Writes an approved outline into a real deck |
| `/api/ai/scene` | `GeneratedScene` | One scene, inserted where the user chooses |
| `/api/ai/rewrite` | `RewriteResult` | Rewrite, shorten, expand, simplify, tone, alternatives |
| `/api/ai/notes` | `SpeakerNotesResult` | Reads the scene from the database, not the request |
| `/api/ai/visuals` | `VisualSuggestion` | Describes what a picture should show |
| `/api/ai/status` | — | Whether a model is configured, so the UI can be honest |

---

## Outline first

The AI path stops at an outline the user can read, edit line by line, delete
scenes from, and regenerate — before a single scene is written.

Reviewing twelve lines takes fifteen seconds. Discovering a bad structure after
forty scenes have been generated costs far more, in tokens and in the user's
patience. The outline is also where the user picks the theme.

Generation then writes scenes into a real deck one at a time, so a failure
part-way through leaves a usable partial deck rather than nothing. The outline's
length wins over the model's: scenes are padded or trimmed to match exactly the
structure the user approved.

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

| Reason | Behaviour |
| --- | --- |
| `not_configured` | UI says so; the deterministic generator takes over |
| `invalid_output` | Retried once; then reported, nothing applied |
| `overloaded` | "Try again in a moment — nothing was changed" |
| `provider_error` | Reported with the underlying message |

Text tools present results as *proposals*. The user picks one, and undo reverses
it like any other edit. AI that silently rewrites your slide creates cleanup;
AI that offers three options saves work.

---

## Without a model

`lib/ai/fallback.ts` produces an editable structural draft, and the UI says
exactly that — "No language model is configured on this deployment, so Captivate
built a structural draft instead."

It derives a real title (stripping framing verbs, format phrases and the article
that belonged to them, so "A 50-minute lecture on recognising shock" yields
"Recognising shock") and uses a narrative skeleton — *Why this matters*, *What
to look for*, *Common mistakes* — rather than keywords lifted from the prompt,
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
