/**
 * Stands in for Next's `server-only` marker under Vitest.
 *
 * The real module has no runtime behaviour — importing it is a build-time
 * assertion that the file never reaches a client bundle, enforced by Next's
 * resolver. Vitest has no such resolver, so a module that guards itself
 * correctly cannot be imported at all without this.
 *
 * Aliasing it here does not weaken the guard: `npm run build` still resolves
 * the real one, and a secret-touching module that lost its import would fail
 * there, in `verify`, before anything shipped.
 */
export {};
