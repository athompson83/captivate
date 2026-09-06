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
 * so that variable is read first.
 *
 * What it must never do is fall back to `localhost` on something that is
 * actually deployed. `robots.txt`, the sitemap and every canonical tag are
 * generated at build time, so a missing variable would not fail loudly — it
 * would publish `http://localhost:3000` to a crawler and quietly uncanonicalise
 * the whole site. Vercel always sets `VERCEL_PROJECT_PRODUCTION_URL` to the
 * project's production domain, on previews as well, which is the right answer
 * for both: a preview that names the production origin as canonical is exactly
 * what we want, and is what the explicit variable would have said anyway.
 *
 * Localhost is therefore reachable only where there is no deployment at all.
 */

const FALLBACK = "http://localhost:3000";

export function siteOrigin(): string {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL?.trim();
  if (explicit) return explicit.replace(/\/$/, "");

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, "").replace(/\/$/, "")}`;

  return FALLBACK;
}

/**
 * Where a request that arrived on the wrong hostname should be sent, or null
 * where it is already in the right place.
 *
 * A deployment answers on more hostnames than the one it is meant to live at:
 * every Vercel project keeps a `*.vercel.app` alias, and every deployment gets
 * its own. That is not cosmetic. **Sessions are per-host**, so someone who
 * signs in on the alias and later opens the real domain is signed out with no
 * explanation, and someone who saves the alias to a phone's home screen has
 * bookmarked a copy of the product that will keep drifting away from the one
 * everybody else uses.
 *
 * So a *production* deployment reached on any `vercel.app` hostname sends the
 * reader to the canonical origin and keeps their path.
 *
 * Two limits worth stating rather than discovering:
 *
 *  - **preview deployments are left alone.** `VERCEL_ENV` is `preview` there,
 *    and bouncing a reviewer from the deployment they were asked to look at to
 *    production would make the preview link useless;
 *  - **this cannot rescue a URL Vercel refuses first.** A per-deployment URL
 *    under Deployment Protection is answered with a redirect to Vercel's own
 *    sign-in at the edge, before any of this application runs. Nothing in this
 *    repository executes on that request, so nothing here can repair it.
 */
export function canonicalRedirect(
  host: string | null,
  pathAndQuery: string,
  env: { siteUrl?: string; vercelEnv?: string } = {
    siteUrl: process.env.NEXT_PUBLIC_SITE_URL,
    vercelEnv: process.env.VERCEL_ENV,
  },
): string | null {
  if (env.vercelEnv !== "production") return null;

  const canonical = env.siteUrl?.trim();
  if (!canonical) return null;

  const requested = host?.split(":")[0]?.toLowerCase();
  if (!requested || !requested.endsWith(".vercel.app")) return null;

  let target: URL;
  try {
    target = new URL(canonical);
  } catch {
    return null;
  }
  // A canonical origin that is itself a vercel.app host would loop.
  if (target.hostname.toLowerCase() === requested) return null;
  if (target.hostname.toLowerCase().endsWith(".vercel.app")) return null;

  return `${target.origin.replace(/\/$/, "")}${pathAndQuery}`;
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

/**
 * Where a reader can write to about their data.
 *
 * An env var rather than a constant because the address belongs to whoever
 * runs the deployment, and inventing one would be worse than having none — a
 * privacy page naming a mailbox nobody reads is a promise that fails silently.
 * Where it is unset the legal pages say so plainly instead of printing a
 * plausible-looking address.
 */
export function supportEmail(): string | null {
  const value = process.env.NEXT_PUBLIC_SUPPORT_EMAIL?.trim();
  return value ? value : null;
}
