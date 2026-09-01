/**
 * Where this deployment says it lives.
 *
 * Canonical tags, `metadataBase`, `robots.txt` and the sitemap all have to
 * agree on one origin, and the one thing that must never happen is a Preview
 * hostname leaking into any of them — a canonical pointing at
 * `captivate-git-…vercel.app` tells a crawler the preview is the real page and
 * the real page is a duplicate.
 *
 * `NEXT_PUBLIC_SITE_URL` is already the deployment's own answer to that
 * question: `src/lib/auth/actions.ts` refuses to send a recovery link without
 * it rather than trusting a request header. The same reasoning applies here,
 * so this reads that variable and nothing else. Locally it falls back to the
 * dev server, where there is no crawler and nothing at stake.
 */

const FALLBACK = "http://localhost:3000";

export function siteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  return (explicit || FALLBACK).replace(/\/$/, "");
}

export function siteUrl(): URL {
  return new URL(siteOrigin());
}

/**
 * Route prefixes that must never be indexed.
 *
 * Two different reasons, kept in one list because a crawler does not care
 * which applies:
 *
 *   * the signed-in application — a crawler is never authenticated, so the
 *     best case is that it indexes a sign-in redirect and the worst is that a
 *     misconfigured gate one day lets it index somebody's deck;
 *   * link-addressed pages. `/v/<token>`, `/handout/<id>` and `/present/<id>`
 *     are reachable by anyone holding the link, which is exactly what makes
 *     them unlisted rather than public. Indexing one turns a share link into a
 *     search result and quietly revokes the author's choice about who sees it.
 */
export const PRIVATE_PATH_PREFIXES = [
  "/home",
  "/new",
  "/presentations",
  "/assets",
  "/notes",
  "/recordings",
  "/settings",
  "/templates",
  "/edit",
  "/present",
  "/handout",
  "/v",
  "/update-password",
  "/reset-password",
  "/api",
] as const;
