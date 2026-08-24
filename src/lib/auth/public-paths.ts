/**
 * What a visitor with no account may reach.
 *
 * This is the whole of the app's front-door policy, and it lives here rather
 * than inside `src/proxy.ts` so it can be tested — the proxy runs in the edge
 * runtime and its default export is not something a unit test can call.
 *
 * It got out of step with the product once, expensively. `/v/<token>` is the
 * public face of a share link: its page says "No sign-in, no session: the
 * token in the URL is the entire authorisation", and the database has a
 * SECURITY DEFINER resolver, two RLS policies and three migrations behind it.
 * The proxy redirected every one of those visitors to a sign-in page, so
 * sharing worked only for people who already had an account — which is nobody
 * a link is sent to. The images were the same story one level down.
 */

const PUBLIC_PREFIXES = [
  "/",
  "/sign-in",
  "/sign-up",
  "/reset-password",
  "/update-password",
  "/auth",
  // The share link. The token is the authorisation, and a dead one 404s.
  "/v",
];

/**
 * `/api/assets/<uuid>/content` serves a private file, and is public *here*
 * because the route itself is the authorisation: RLS resolves it for an owner,
 * `captivate_shared_asset` resolves it for a link-holder while the deck is
 * shared, and everyone else gets the same 404 as a file that does not exist.
 *
 * Deliberately narrow. `/api/assets` without an id lists the caller's own
 * library and must stay behind the gate; so must every other API route.
 */
const PUBLIC_ASSET_CONTENT =
  /^\/api\/assets\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/content$/i;

export function isPublicPath(pathname: string): boolean {
  if (PUBLIC_ASSET_CONTENT.test(pathname)) return true;
  return PUBLIC_PREFIXES.some(
    (prefix) => pathname === prefix || pathname.startsWith(`${prefix}/`),
  );
}
