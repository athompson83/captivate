/**
 * The sandbox an embedded page is given.
 *
 * `allow-scripts` with `allow-same-origin` is the documented sandbox escape:
 * together they hand the framed document its real origin *and* the ability to
 * run code there. For a third-party embed that is contained and necessary —
 * a video player cannot authenticate or remember a position without its own
 * origin — but it stops being contained the moment the embed points back at
 * this application. A frame that is same-origin with its parent can reach
 * `window.parent.document`, remove its own `sandbox` attribute, reload itself
 * and read the app origin's `localStorage`, which is where the session lives.
 *
 * Today nothing under this origin serves author-controlled bytes, so that is a
 * latent hazard rather than a hole. It stops being latent the first time an
 * asset route proxies content instead of redirecting to storage — which is a
 * one-line change somebody will make for a good reason.
 *
 * So the pairing is decided per URL rather than baked into the markup: an
 * embed of this deployment is framed without `allow-same-origin`, and
 * everything else keeps the sandbox a real embed needs.
 */

const BASE = "allow-scripts allow-presentation";
const THIRD_PARTY = `${BASE} allow-same-origin`;

export function embedSandbox(url: string, siteOrigin: string | undefined): string {
  // No declared origin means a development server, where there is no session
  // worth taking and no deployment to point at. Being strict here would break
  // every real embed while a developer worked, which is how a check like this
  // ends up deleted. `NEXT_PUBLIC_SITE_URL` is required in production —
  // see docs/DEPLOYMENT.md.
  if (!siteOrigin) return THIRD_PARTY;

  try {
    const site = new URL(siteOrigin).origin;
    return new URL(url, site).origin === site ? BASE : THIRD_PARTY;
  } catch {
    // An origin we cannot parse is one we cannot clear.
    return BASE;
  }
}
