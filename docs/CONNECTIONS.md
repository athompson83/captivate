# Connections

Every external service Captivate touches, and exactly how.

---

## Supabase

**Project:** `qnbwyymwhvqprjtyfdmb` (`Captivate`, region `us-west-2`,
Postgres 17). Live and in use.

Used for three things:

| Service | Client | Notes |
| --- | --- | --- |
| Postgres | `@supabase/ssr` | Every query runs as the signed-in user, so RLS applies |
| Auth | `@supabase/ssr` | Email and password; session refreshed in the proxy layer |
| Storage | `@supabase/supabase-js` | Three private buckets; browser uploads directly |

Three client modules, deliberately separate:

- `lib/supabase/client.ts` — browser, memoised so every component shares one
  connection and one auth listener.
- `lib/supabase/server.ts` — request-scoped, reads and refreshes auth cookies.
  `getCurrentUser()` calls `getUser()`, which verifies the JWT, rather than
  decoding a cookie.
- `lib/supabase/admin.ts` — service role, marked `server-only`. Currently unused
  by any request path; it exists so that if a future feature genuinely needs to
  bypass RLS, it has one obvious place to live.

**Uploads go browser → storage directly**, never through a server function. That
avoids serverless body-size limits entirely, and storage RLS makes the
client-chosen path safe: the object key must start with the caller's user id.

**Reads come back through the app.** Scene content stores
`/api/assets/:id/content`, a permanent reference that resolves to a fresh signed
URL per request after an ownership check. Signed URLs expire; a deck must still
render a year later.

---

## Anthropic

Optional. Without `ANTHROPIC_API_KEY` the AI routes report "not configured" and
a deterministic generator produces an editable structural draft, labelled as
exactly that rather than passed off as written content.

Everything goes through one function, `generateStructured` in
`lib/ai/provider.ts`. It:

- derives a JSON Schema from a Zod schema and forces a tool call, so there is no
  free-text parsing anywhere;
- validates the result against that same Zod schema;
- retries once, feeding the validation error back, before giving up;
- reports token usage, which is written to `ai_generations`.

Swapping providers means reimplementing that one function.

Model defaults to `claude-sonnet-5`, overridable with `CAPTIVATE_AI_MODEL`.
Output is capped at 8,000 tokens as a runaway guard, and callers are rate limited
per user per hour.

---

## Browser APIs

Captivate relies on the platform rather than shipping libraries that duplicate
it. Each has a fallback.

| API | Used for | If unavailable |
| --- | --- | --- |
| `BroadcastChannel` | Stage ↔ console sync | Single-window presenting still works |
| Fullscreen | True full-screen stage | Message explaining it, stage fills the window |
| `getDisplayMedia` | Recording the stage | Recording marked unavailable, with the reason |
| `getUserMedia` | Microphone and camera | Declined mic aborts; declined camera downgrades to screen + mic |
| `MediaRecorder` | Encoding | Recording marked unavailable, with the reason |
| `canvas.captureStream` | Camera compositing | Only needed when the camera is on |
| Screen Wake Lock | Stops the display sleeping | Screen may dim; not fatal |
| `ResizeObserver` | Fit-to-container scaling | Required; universally available |

---

## Hosting

Designed for Vercel; nothing in the code is Vercel-specific. There is no custom
server, no edge runtime requirement, and no platform-specific API.

At the time of writing the project has **not** been created on Vercel: the
connection available to this workspace returns `403 forbidden` on project
creation, so the repository has to be imported once by hand. See
[DEPLOYMENT.md](DEPLOYMENT.md).

---

## Not connected

No analytics, no error reporting service, no email provider of our own (Supabase
sends auth email), no payment processor, no CDN beyond the host's, and no
third-party fonts at runtime — `next/font` self-hosts them at build time, which
is why `font-src` can stay tight.
