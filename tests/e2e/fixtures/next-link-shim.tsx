/**
 * Stand-in for `next/link` inside server-free fixtures.
 *
 * The fixtures open from the file system with no Next runtime, so the real
 * `Link` — which wants the app router mounted — cannot be bundled. A link in
 * a fixture only ever needs to *be* a link; navigation is not under test.
 */
export default function Link({
  href,
  children,
  ...rest
}: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) {
  return (
    <a href={href} {...rest}>
      {children}
    </a>
  );
}
