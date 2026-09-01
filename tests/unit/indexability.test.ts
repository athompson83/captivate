import { afterEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import robots from "@/app/robots";
import sitemap from "@/app/sitemap";
import { PRIVATE_PATH_PREFIXES } from "@/lib/site";

/**
 * Who is allowed to find what.
 *
 * The root layout used to carry `robots: { index: false, follow: false }`,
 * which applied to every route in the application. That is the right default
 * while a product is being built and the wrong one the moment it has a front
 * door: the landing page, the pricing page and the sign-up path were all
 * invisible to search, so the one thing the marketing site exists to do — let
 * a stranger arrive — could not happen.
 *
 * Removing it inverts the default: a route is now indexable unless it says
 * otherwise. That is correct for a public product and dangerous for this one
 * in particular, because several routes are addressed by link rather than by
 * permission. `/v/<token>` is the sharpest case: the author decided who gets
 * that link, and a crawler putting it in a search result revokes the decision
 * on their behalf, silently.
 *
 * So the opt-outs are asserted rather than trusted. These read the source
 * because the claim is about what each route *declares* — a rendered-HTML
 * check would need a server, an account and a real deck for the very routes
 * that matter most, and would quietly skip them.
 */

const read = (path: string) => readFileSync(join(process.cwd(), path), "utf8");

/** `siteOrigin` reads the environment when called, so a plain import is enough. */
const freshSite = () => import("@/lib/site");

/** Every route that must never appear in a search result, and why it exists. */
const MUST_NOT_INDEX: { file: string; reason: string }[] = [
  { file: "src/app/(app)/layout.tsx", reason: "the whole signed-in application" },
  { file: "src/app/edit/[id]/page.tsx", reason: "someone's deck, mid-edit" },
  { file: "src/app/present/[id]/page.tsx", reason: "the stage" },
  { file: "src/app/present/[id]/console/page.tsx", reason: "presenter console, carries notes" },
  { file: "src/app/present/[id]/remote/page.tsx", reason: "phone remote" },
  { file: "src/app/handout/[id]/page.tsx", reason: "handout, reachable by link" },
  { file: "src/app/v/[token]/page.tsx", reason: "share link" },
  { file: "src/app/(auth)/update-password/page.tsx", reason: "recovery-token flow" },
  { file: "src/app/(auth)/reset-password/page.tsx", reason: "recovery flow" },
];

describe("what a crawler may index", () => {
  it.each(MUST_NOT_INDEX)("$file opts out — $reason", ({ file }) => {
    expect(read(file)).toMatch(/robots:\s*\{\s*index:\s*false/);
  });

  it("the root layout no longer hides the whole product", () => {
    const layout = read("src/app/layout.tsx");
    expect(layout).not.toMatch(/robots:\s*\{\s*index:\s*false/);
    // …and still resolves canonical/social URLs against one configured origin,
    // so a Preview build cannot advertise itself as the canonical copy.
    expect(layout).toContain("metadataBase");
  });

  it("the landing page, pricing and sign-up stay indexable", () => {
    for (const file of [
      "src/app/page.tsx",
      "src/app/pricing/page.tsx",
      "src/app/(auth)/sign-up/page.tsx",
    ]) {
      expect(read(file), file).not.toMatch(/robots:\s*\{\s*index:\s*false/);
    }
  });
});

describe("robots.txt", () => {
  it("disallows every private prefix, and the exact path as well as what is under it", () => {
    const { rules } = robots();
    const rule = Array.isArray(rules) ? rules[0] : rules;
    const disallowed = ([] as string[]).concat(rule.disallow ?? []);
    for (const prefix of PRIVATE_PATH_PREFIXES) {
      // `/settings/` covers `/settings/billing` and not `/settings`, which is
      // the route that actually exists. Both forms, or the real one is open.
      expect(disallowed, prefix).toContain(`${prefix}/`);
      expect(disallowed, prefix).toContain(`${prefix}$`);
    }
  });

  it("does not disallow a bare prefix, which would swallow its neighbours", () => {
    // `/new` unanchored also matches `/newsletter`. The anchored form is the
    // whole reason both rules are emitted rather than one.
    const { rules } = robots();
    const rule = Array.isArray(rules) ? rules[0] : rules;
    const disallowed = ([] as string[]).concat(rule.disallow ?? []);
    for (const prefix of PRIVATE_PATH_PREFIXES) {
      expect(disallowed, prefix).not.toContain(prefix);
    }
  });

  it("does not disallow the pages it is meant to attract people to", () => {
    const { rules } = robots();
    const rule = Array.isArray(rules) ? rules[0] : rules;
    const disallowed = ([] as string[]).concat(rule.disallow ?? []);
    for (const open of ["/", "/pricing/", "/sign-up/"]) {
      expect(disallowed).not.toContain(open);
    }
  });
});

describe("the sitemap", () => {
  it("lists only public pages, on one absolute origin", () => {
    const entries = sitemap();
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      const url = new URL(entry.url);
      expect(url.protocol).toMatch(/^https?:$/);
      // A sitemap advertising a private path is worse than no sitemap: it is
      // an invitation to crawl exactly what the meta tags are refusing.
      for (const prefix of PRIVATE_PATH_PREFIXES) {
        expect(url.pathname.startsWith(prefix), `${url.pathname} vs ${prefix}`).toBe(false);
      }
    }
  });

  it("agrees with robots.txt about which origin is canonical", () => {
    const host = robots().host as string;
    for (const entry of sitemap()) {
      expect(entry.url.startsWith(host)).toBe(true);
    }
  });
});

/**
 * A canonical is a claim about one page, so it is made on that page.
 *
 * Next merges metadata field by field down the tree, which means a canonical on
 * the root layout is inherited by every route that does not set its own. It was
 * set there, to `/`, and every indexable page except the two legal ones took
 * it — telling a crawler that the pricing page and the sign-up page are
 * duplicates of the landing page and should be dropped. That is the same
 * failure as the site-wide `noindex` this file exists for, arriving by
 * inheritance instead of by declaration.
 */
describe("canonical URLs", () => {
  const INDEXABLE: { file: string; canonical: string }[] = [
    { file: "src/app/page.tsx", canonical: "/" },
    { file: "src/app/pricing/page.tsx", canonical: "/pricing" },
    { file: "src/app/(auth)/sign-up/page.tsx", canonical: "/sign-up" },
    { file: "src/app/(auth)/sign-in/page.tsx", canonical: "/sign-in" },
    { file: "src/app/(legal)/privacy/page.tsx", canonical: "/privacy" },
    { file: "src/app/(legal)/terms/page.tsx", canonical: "/terms" },
  ];

  it.each(INDEXABLE)("$file claims $canonical for itself", ({ file, canonical }) => {
    expect(read(file)).toContain(`canonical: "${canonical}"`);
  });

  it("the root layout claims none, so nothing inherits one", () => {
    expect(read("src/app/layout.tsx")).not.toMatch(/canonical:/);
  });

  it("every page the sitemap advertises has said which URL it is", () => {
    const declared = new Set(INDEXABLE.map((route) => route.canonical));
    for (const entry of sitemap()) {
      expect(declared, entry.url).toContain(new URL(entry.url).pathname);
    }
  });
});

/**
 * The origin is generated into files a crawler reads, at build time.
 *
 * `robots.txt`, the sitemap and every canonical tag are written once when the
 * application is built, so a missing `NEXT_PUBLIC_SITE_URL` cannot fail loudly
 * at request time — it would publish `http://localhost:3000` to Google and
 * uncanonicalise the site in a way nothing in the application would notice.
 */
describe("which origin a deployment publishes", () => {
  const ENV = { ...process.env };
  afterEach(() => {
    process.env = { ...ENV };
  });

  it("prefers the configured origin", async () => {
    process.env.NEXT_PUBLIC_SITE_URL = "https://www.example.com/";
    const { siteOrigin } = await freshSite();
    expect(siteOrigin()).toBe("https://www.example.com");
  });

  it("never says localhost on a deployment that did not configure one", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = "www.example.com";
    const { siteOrigin } = await freshSite();
    expect(siteOrigin()).toBe("https://www.example.com");
  });

  it("falls back to localhost only where nothing is deployed", async () => {
    delete process.env.NEXT_PUBLIC_SITE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    const { siteOrigin } = await freshSite();
    expect(siteOrigin()).toBe("http://localhost:3000");
  });
});
