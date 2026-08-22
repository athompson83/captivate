import { describe, expect, it } from "vitest";
import { embedSandbox } from "@/lib/utils/embed";

/**
 * `allow-scripts` plus `allow-same-origin` is the pairing that lets a framed
 * document reach out of its sandbox. It is the right pairing for a video
 * player on its own origin and exactly the wrong one for an embed pointing
 * back at this deployment, which could then read the session out of
 * `localStorage`.
 */
describe("embedSandbox", () => {
  const SITE = "https://captivate.example";

  it("gives third-party embeds the origin a real player needs", () => {
    expect(embedSandbox("https://www.youtube.com/embed/x", SITE)).toContain("allow-same-origin");
  });

  it("refuses it to an embed of this deployment", () => {
    expect(embedSandbox(`${SITE}/edit/123`, SITE)).not.toContain("allow-same-origin");
  });

  it("treats a relative URL as this deployment", () => {
    // A relative src resolves against the app, so it is same-origin however
    // harmless the path looks.
    expect(embedSandbox("/api/assets/1/content", SITE)).not.toContain("allow-same-origin");
  });

  it("does not confuse a lookalike host for this one", () => {
    expect(embedSandbox("https://captivate.example.evil.test/", SITE)).toContain(
      "allow-same-origin",
    );
  });

  it("distinguishes scheme and port, which are part of an origin", () => {
    expect(embedSandbox("http://captivate.example/", SITE)).toContain("allow-same-origin");
    expect(embedSandbox("https://captivate.example:8443/", SITE)).toContain("allow-same-origin");
  });

  it("keeps scripts sandboxed and never grants top-level navigation", () => {
    for (const sandbox of [
      embedSandbox("https://elsewhere.test/", SITE),
      embedSandbox(`${SITE}/x`, SITE),
      embedSandbox("https://elsewhere.test/", undefined),
    ]) {
      expect(sandbox).toContain("allow-scripts");
      expect(sandbox).not.toContain("allow-top-navigation");
      expect(sandbox).not.toContain("allow-popups");
      expect(sandbox).not.toContain("allow-modals");
    }
  });

  it("stays permissive with no declared origin, which is a dev server", () => {
    // Being strict here would break every real embed while somebody worked,
    // which is how a check like this ends up deleted.
    expect(embedSandbox("https://www.youtube.com/embed/x", undefined)).toContain(
      "allow-same-origin",
    );
  });

  it("withholds it when the origin cannot be parsed at all", () => {
    expect(embedSandbox("https://elsewhere.test/", "not a url")).not.toContain("allow-same-origin");
  });
});
