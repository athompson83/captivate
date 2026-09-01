import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Fetching an image the server chose.
 *
 * This is the only place in Captivate where the server makes an outbound
 * request to a URL that came, however indirectly, from something a provider
 * said. Everything about it is deliberately narrow: two hostnames, a byte
 * ceiling enforced while reading rather than after, and a format taken from
 * the bytes because `Content-Type` is a claim.
 *
 * The failure this guards against is the one where it quietly becomes a
 * general-purpose "fetch whatever you are told" utility — which is a server-
 * side request forgery primitive, not an image loader.
 */

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4]);
const NOT_AN_IMAGE = new TextEncoder().encode("<?php echo 'hello'; ?>");

const PEXELS = "https://images.pexels.com/photos/1/x.jpg";

function respondWith(bytes: Uint8Array, headers: Record<string, string> = {}) {
  return {
    ok: true,
    headers: new Headers(headers),
    body: {
      getReader() {
        let sent = false;
        return {
          async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: bytes };
          },
          async cancel() {},
        };
      },
    },
  } as unknown as Response;
}

/** A body that never ends, to prove the ceiling stops reading rather than buffers. */
function endlessResponse(chunkSize: number) {
  let cancelled = false;
  const chunk = new Uint8Array(chunkSize);
  chunk.set(PNG.slice(0, 8));
  return {
    response: {
      ok: true,
      headers: new Headers(),
      body: {
        getReader() {
          return {
            async read() {
              return cancelled ? { done: true, value: undefined } : { done: false, value: chunk };
            },
            async cancel() {
              cancelled = true;
            },
          };
        },
      },
    } as unknown as Response,
    wasCancelled: () => cancelled,
  };
}

describe("fetchImageBytes", () => {
  beforeEach(() => {
    vi.resetModules();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("accepts a PNG from an allowed host and reads its type from the bytes", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respondWith(PNG, { "content-type": "text/plain" })),
    );
    const { fetchImageBytes } = await import("@/lib/ai/visual-sourcing");

    const result = await fetchImageBytes(PEXELS);
    expect(result.ok).toBe(true);
    // The header said text/plain. The bytes say PNG, and the bytes win.
    if (result.ok) expect(result.data.mimeType).toBe("image/png");
  });

  it("accepts a JPEG too", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respondWith(JPEG)),
    );
    const { fetchImageBytes } = await import("@/lib/ai/visual-sourcing");
    const result = await fetchImageBytes(PEXELS);
    expect(result.ok && result.data.extension).toBe("jpg");
  });

  it("refuses a host that is not one of ours, without making a request", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { fetchImageBytes } = await import("@/lib/ai/visual-sourcing");

    const result = await fetchImageBytes("https://evil.example.com/x.png");
    expect(result).toEqual({ ok: false, error: "host-not-allowed" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses an internal address, which is the whole point of the allowlist", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { fetchImageBytes } = await import("@/lib/ai/visual-sourcing");

    for (const url of [
      "http://169.254.169.254/latest/meta-data/",
      "https://localhost/admin",
      "https://127.0.0.1/",
      "file:///etc/passwd",
    ]) {
      expect(await fetchImageBytes(url)).toEqual({ ok: false, error: "host-not-allowed" });
    }
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses plain http even on an allowed host", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { fetchImageBytes } = await import("@/lib/ai/visual-sourcing");

    const result = await fetchImageBytes("http://images.pexels.com/photos/1/x.jpg");
    expect(result).toEqual({ ok: false, error: "host-not-allowed" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("refuses a declared size over the upload ceiling before reading a byte", async () => {
    const { MAX_UPLOAD_BYTES } = await import("@/lib/data/upload-limits");
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respondWith(PNG, { "content-length": String(MAX_UPLOAD_BYTES + 1) })),
    );
    const { fetchImageBytes } = await import("@/lib/ai/visual-sourcing");

    expect(await fetchImageBytes(PEXELS)).toEqual({ ok: false, error: "too-large" });
  });

  it("abandons a response that lies about its size, rather than buffering it", async () => {
    const { MAX_UPLOAD_BYTES } = await import("@/lib/data/upload-limits");
    // A tenth of the ceiling per chunk: eleven reads to exceed it, and the
    // stream would otherwise go on forever.
    const endless = endlessResponse(Math.ceil(MAX_UPLOAD_BYTES / 10));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => endless.response),
    );
    const { fetchImageBytes } = await import("@/lib/ai/visual-sourcing");

    expect(await fetchImageBytes(PEXELS)).toEqual({ ok: false, error: "too-large" });
    expect(endless.wasCancelled(), "the reader must be cancelled, not just abandoned").toBe(true);
  });

  it("refuses something that is not an image whatever it claims", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => respondWith(NOT_AN_IMAGE, { "content-type": "image/png" })),
    );
    const { fetchImageBytes } = await import("@/lib/ai/visual-sourcing");

    expect(await fetchImageBytes(PEXELS)).toEqual({ ok: false, error: "not-an-image" });
  });

  it("treats a network failure as unreachable rather than throwing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("ECONNRESET");
      }),
    );
    const { fetchImageBytes } = await import("@/lib/ai/visual-sourcing");

    expect(await fetchImageBytes(PEXELS)).toEqual({ ok: false, error: "unreachable" });
  });
});

describe("the ingest allowlist", () => {
  it("names hosts explicitly rather than matching a pattern", async () => {
    const { INGEST_HOSTS } = await import("@/lib/ai/visual-sourcing");
    // A pattern like *.pexels.com would admit any subdomain a provider — or
    // anyone who can register one — happens to control.
    for (const host of INGEST_HOSTS) {
      expect(host).not.toContain("*");
      expect(host.split(".").length).toBeGreaterThanOrEqual(2);
    }
    expect(INGEST_HOSTS.size).toBeLessThanOrEqual(4);
  });
});
