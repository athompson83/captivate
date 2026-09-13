/**
 * Stand-in for `next/navigation` inside server-free fixtures.
 *
 * The fixtures open from the file system with no Next runtime, so the real
 * hooks — which read the app router's context — cannot be bundled. A
 * component in a fixture only ever needs a pathname to compare against, the
 * query to read, and a router whose pushes are recorded rather than
 * followed; navigation itself is not under test. `window.navigationShim`
 * lets a fixture set the pathname and read what was pushed.
 */

declare global {
  interface Window {
    navigationShim: { pathname: string; pushed: string[] };
  }
}

window.navigationShim ??= { pathname: "/", pushed: [] };

export function usePathname(): string {
  return window.navigationShim.pathname;
}

export function useSearchParams(): URLSearchParams {
  return new URLSearchParams(window.location.search);
}

export function useRouter() {
  const record = (href: string) => {
    window.navigationShim.pushed.push(href);
  };
  return {
    push: record,
    replace: record,
    prefetch: () => {},
    back: () => {},
    forward: () => {},
    refresh: () => {},
  };
}

export function useParams(): Record<string, string> {
  return {};
}

export function redirect(href: string): never {
  throw new Error(`redirect(${href}) in a fixture`);
}

export function notFound(): never {
  throw new Error("notFound() in a fixture");
}
