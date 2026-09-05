import "server-only";

/**
 * A response that keeps the connection warm while a long route works.
 *
 * Writing a full deck is one model call of ninety seconds or more, and the
 * route said nothing until it was done. A phone does not wait that long: iOS
 * gives up on a request that has received no bytes for sixty seconds and
 * reports it as a network failure — so the owner watched "Couldn't reach the
 * server" while, on the server, the deck finished writing and was saved.
 * Twice. The same silence trips any proxy with an idle timeout.
 *
 * The headers go out at once and a newline follows every ten seconds until
 * the work resolves; the route's own JSON is the last thing written. Leading
 * whitespace is valid JSON, so the client reads the body with `response.json()`
 * exactly as before.
 *
 * What is lost is the status code — a streamed response commits to 200 before
 * the outcome is known — so the route's error, when there is one, travels as
 * the `error` field of the body, which every AI client already reads. The
 * checks that produce a real status (signed out, rate limited, malformed
 * input) run before this wrapper and keep theirs.
 */
/** Well inside the sixty seconds a phone allows between bytes. */
export const HEARTBEAT_MS = 10_000;
/** JSON whitespace: the body stays a single JSON value with a long prelude. */
export const HEARTBEAT = "\n";

export function keepAlive(work: () => Promise<Response>): Response {
  const encoder = new TextEncoder();
  let heartbeat: ReturnType<typeof setInterval> | null = null;
  let open = true;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const write = (text: string) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          // The reader went away mid-generation. The work still finishes and
          // is still saved; there is simply nobody left to tell.
          open = false;
        }
      };

      heartbeat = setInterval(() => write(HEARTBEAT), HEARTBEAT_MS);
      try {
        const response = await work();
        const body = await response.text();
        write(body.length > 0 ? body : JSON.stringify({ error: SILENT_ROUTE }));
      } catch {
        write(JSON.stringify({ error: FAILED_ROUTE }));
      } finally {
        if (heartbeat) clearInterval(heartbeat);
        if (open) {
          open = false;
          controller.close();
        }
      }
    },
    cancel() {
      open = false;
      if (heartbeat) clearInterval(heartbeat);
    },
  });

  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // `no-transform` asks every hop not to buffer the body for compression;
      // a heartbeat that sits in a gzip window is no heartbeat.
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
    },
  });
}

const SILENT_ROUTE = "The server finished without saying what happened. Check your dashboard.";
const FAILED_ROUTE =
  "Something went wrong while generating. Check your dashboard before trying again — the work may already be there.";
