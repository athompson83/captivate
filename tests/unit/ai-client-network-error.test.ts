import { afterEach, describe, expect, it, vi } from "vitest";
import { NETWORK_ERROR, requestMap } from "@/lib/ai/client";

/**
 * `create-from-map` (and every other AI route) can commit its work and then
 * lose the connection before the response body arrives — Vercel severs a
 * killed function rather than returning a response, and a dropped connection
 * on an otherwise-OK response looks the same to `fetch`. Both must be
 * reported as NETWORK_ERROR so a caller like `create-flow.tsx` that checks
 * for that exact string treats them the same partial-write risk instead of
 * only catching the case where `fetch` itself rejects.
 */
describe("post() treats an unreadable response body as a network error", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("returns NETWORK_ERROR when the response is OK but response.json() rejects", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: () => Promise.reject(new Error("Unexpected end of JSON input")),
      }),
    );

    const result = await requestMap({ prompt: "A talk on peptide therapeutics" });

    expect(result).toEqual({ ok: false, error: NETWORK_ERROR });
  });
});
