import type { MetadataRoute } from "next";
import { PRIVATE_PATH_PREFIXES, siteOrigin } from "@/lib/site";

/**
 * Belt and braces with the per-route `robots` metadata.
 *
 * The `noindex` tags on the private layouts are the authoritative answer — a
 * crawler has to fetch the page to read them, and that is fine, because
 * fetching an authenticated route without a session gets it a redirect. This
 * file saves it the trip, and covers the case a meta tag cannot: a route that
 * fails before rendering its own metadata still has its path disallowed here.
 */
export default function robots(): MetadataRoute.Robots {
  const origin = siteOrigin();
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      // Two rules per prefix, because one cannot say what we mean. A rule is
      // matched literally from the first octet, so `/new/` covers `/new/from-file`
      // and not `/new` itself, while a bare `/new` would also swallow any future
      // `/newsletter` — the same shape of over-broad rule this file exists to
      // undo. `$` anchors the exact path on every major crawler; one that does
      // not implement it simply ignores the rule and is left with the `/`
      // form, which is where this stood before.
      disallow: PRIVATE_PATH_PREFIXES.flatMap((prefix) => [`${prefix}$`, `${prefix}/`]),
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
