import Link from "next/link";
import { Sparkles } from "lucide-react";

/**
 * The public site's header and footer.
 *
 * Shared so the front door and the pricing page cannot drift into looking
 * like two different products, which is exactly what happened when pricing
 * was added: a light, chromeless page hanging off a dark one.
 */

export function SiteHeader() {
  return (
    <header className="border-b border-[var(--sky-line)]/60 backdrop-blur-sm">
      <div className="shell flex items-center justify-between py-5">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="flex size-8 items-center justify-center rounded-[var(--radius-md)] bg-[var(--sky-amber)]">
            <Sparkles className="size-4 text-[oklch(0.18_0.03_60)]" aria-hidden />
          </span>
          <span className="text-[15px] font-semibold tracking-tight text-[var(--sky-ink)]">
            Captivate
          </span>
        </Link>
        <nav className="flex items-center gap-1.5 sm:gap-2">
          <Link
            href="/pricing"
            className="hidden rounded-[var(--radius-md)] px-3.5 py-2 text-[13px] font-medium text-[var(--sky-ink-2)] transition-colors hover:text-[var(--sky-ink)] sm:inline-block"
          >
            Pricing
          </Link>
          <Link
            href="/sign-in"
            className="rounded-[var(--radius-md)] px-3.5 py-2 text-[13px] font-medium text-[var(--sky-ink-2)] transition-colors hover:text-[var(--sky-ink)]"
          >
            Sign in
          </Link>
          <Link
            href="/sign-up"
            className="rounded-[var(--radius-md)] bg-[var(--sky-amber)] px-3.5 py-2 text-[13px] font-medium text-[oklch(0.18_0.03_60)] transition-opacity hover:opacity-90"
          >
            Get started
          </Link>
        </nav>
      </div>
    </header>
  );
}

export function SiteFooter() {
  return (
    <footer className="border-t border-[var(--sky-line)]/70">
      <div className="shell flex flex-wrap items-center justify-between gap-4 py-7 text-[12.5px] text-[var(--sky-ink-3)]">
        <span>Captivate — presentations for educators, clinicians and speakers.</span>
        <span className="flex items-center gap-5">
          <Link href="/pricing" className="transition-colors hover:text-[var(--sky-ink)]">
            Pricing
          </Link>
          <Link href="/sign-in" className="transition-colors hover:text-[var(--sky-ink)]">
            Sign in
          </Link>
          <Link href="/sign-up" className="font-medium text-[var(--sky-amber)] hover:underline">
            Get started
          </Link>
        </span>
      </div>
    </footer>
  );
}
