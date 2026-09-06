import { describe, expect, it } from "vitest";
import { canonicalRedirect } from "@/lib/site";

/**
 * One product, one hostname.
 *
 * A Vercel project answers on more hostnames than the one it lives at: a
 * stable `*.vercel.app` alias, plus a URL per deployment. Verified against the
 * running deployment on 2026-09-06 — `captivate-eight.vercel.app` returns 200,
 * the custom domain returns 200, and a per-deployment URL returns a 302 to
 * `vercel.com/sso-api`.
 *
 * The two that answer are the problem, because **sessions are per-host**.
 * Someone who signs in on the alias and later opens the real domain is signed
 * out with no explanation; someone who saves the alias to a phone's home
 * screen has bookmarked a copy of the product that drifts away from the one
 * everyone else uses. The owner hit exactly this: a saved shortcut, and a
 * "Present" button that is a *relative* link and so could only keep them
 * wherever they already were.
 *
 * What this cannot do is stated in the tests too, because the limit is the
 * thing most likely to be forgotten: a deployment URL behind Vercel's own
 * authentication is answered at the edge, before this application runs.
 */

const prod = (siteUrl: string) => ({ siteUrl, vercelEnv: "production" });
const CANONICAL = "https://captivate.axtevi.com";

describe("a production deployment on the wrong hostname", () => {
  it("sends the reader to the canonical origin, keeping where they were going", () => {
    expect(
      canonicalRedirect("captivate-eight.vercel.app", "/present/abc?audience=1", prod(CANONICAL)),
    ).toBe("https://captivate.axtevi.com/present/abc?audience=1");
  });

  it("ignores the port a host header may carry", () => {
    expect(canonicalRedirect("captivate-eight.vercel.app:443", "/home", prod(CANONICAL))).toBe(
      "https://captivate.axtevi.com/home",
    );
  });

  it("leaves the canonical domain alone", () => {
    expect(canonicalRedirect("captivate.axtevi.com", "/home", prod(CANONICAL))).toBeNull();
    expect(canonicalRedirect("www.axtevi.com", "/home", prod(CANONICAL))).toBeNull();
  });

  it("leaves a hostname that merely contains the words alone", () => {
    // `.endsWith` on the hostname, not a substring match anywhere in it.
    expect(canonicalRedirect("vercel.app.example.com", "/home", prod(CANONICAL))).toBeNull();
    expect(canonicalRedirect("notvercel.app.evil.test", "/home", prod(CANONICAL))).toBeNull();
  });
});

describe("what it deliberately does not touch", () => {
  it("leaves preview deployments where they are", () => {
    // A reviewer opening a preview link wants the preview. Bouncing them to
    // production would make every PR comment's link useless.
    expect(
      canonicalRedirect("captivate-git-branch-team.vercel.app", "/home", {
        siteUrl: CANONICAL,
        vercelEnv: "preview",
      }),
    ).toBeNull();
  });

  it("does nothing on a local development server", () => {
    expect(
      canonicalRedirect("localhost:3000", "/home", { siteUrl: CANONICAL, vercelEnv: undefined }),
    ).toBeNull();
  });

  it("does nothing when the deployment has not been told where it lives", () => {
    // No canonical origin means no answer, and inventing one from a request
    // header is exactly what `siteOrigin` refuses to do.
    expect(canonicalRedirect("captivate-eight.vercel.app", "/home", prod(""))).toBeNull();
    expect(
      canonicalRedirect("captivate-eight.vercel.app", "/home", {
        siteUrl: undefined,
        vercelEnv: "production",
      }),
    ).toBeNull();
  });

  it("never redirects to itself, however the origin is configured", () => {
    // A deployment whose canonical origin is a vercel.app host would send the
    // reader in a circle. Both the same-host case and the general one.
    expect(
      canonicalRedirect(
        "captivate-eight.vercel.app",
        "/home",
        prod("https://captivate-eight.vercel.app"),
      ),
    ).toBeNull();
    expect(
      canonicalRedirect(
        "captivate-other.vercel.app",
        "/home",
        prod("https://captivate-eight.vercel.app"),
      ),
    ).toBeNull();
  });

  it("does nothing with an origin that is not a URL", () => {
    expect(canonicalRedirect("captivate-eight.vercel.app", "/home", prod("not a url"))).toBeNull();
  });

  it("does nothing without a host header to read", () => {
    expect(canonicalRedirect(null, "/home", prod(CANONICAL))).toBeNull();
  });
});
