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
      disallow: PRIVATE_PATH_PREFIXES.map((prefix) => `${prefix}/`),
    },
    sitemap: `${origin}/sitemap.xml`,
    host: origin,
  };
}
