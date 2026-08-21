"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import {
  FileText,
  Home,
  Images,
  LayoutTemplate,
  Menu,
  Notebook,
  Settings,
  Sparkles,
  Video,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { UserMenu } from "@/components/user-menu";
import { CommandPalette } from "@/components/command-palette";

const NAV = [
  { href: "/home", label: "Home", icon: Home },
  { href: "/presentations", label: "Presentations", icon: FileText },
  { href: "/notes", label: "Notes", icon: Notebook },
  { href: "/assets", label: "Assets", icon: Images },
  { href: "/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/recordings", label: "Recordings", icon: Video },
] as const;

export function AppShell({
  user,
  children,
}: {
  user: { email: string; displayName: string; avatarUrl: string | null };
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => setMobileOpen(false), [pathname]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="flex min-h-screen bg-base">
      {/* Mobile scrim */}
      {mobileOpen && (
        <button
          aria-label="Close navigation"
          onClick={() => setMobileOpen(false)}
          className="fixed inset-0 z-40 bg-black/50 md:hidden"
        />
      )}

      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-[248px] shrink-0 flex-col border-r border-line-subtle bg-sunken",
          "transition-transform duration-[var(--duration-base)] ease-[var(--ease-out-quint)] md:sticky md:top-0 md:h-screen md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between px-4">
          <Link href="/home" className="flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-[var(--radius-sm)] bg-accent">
              <Sparkles className="size-3.5 text-[var(--accent-contrast)]" aria-hidden />
            </span>
            <span className="text-[14px] font-semibold tracking-tight text-ink">Captivate</span>
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="rounded p-1 text-ink-3 md:hidden"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <button
          onClick={() => setPaletteOpen(true)}
          className="mx-3 mb-3 flex items-center gap-2 rounded-[var(--radius-md)] border border-line-subtle bg-[var(--surface-inset)] px-2.5 py-2 text-left text-[13px] text-ink-3 transition-colors hover:border-line hover:text-ink-2"
        >
          <span className="flex-1">Search or jump to…</span>
          <kbd className="rounded border border-line-subtle px-1 font-sans text-[10px]">⌘K</kbd>
        </button>

        <nav aria-label="Main" className="flex-1 overflow-y-auto px-3 pb-4">
          <ul className="space-y-0.5">
            {NAV.map(({ href, label, icon: Icon }) => {
              const active = pathname === href || pathname.startsWith(`${href}/`);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "relative flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-[13px] font-medium",
                      "transition-colors duration-[var(--duration-fast)]",
                      active ? "text-ink" : "text-ink-3 hover:bg-[var(--surface-inset)] hover:text-ink-2",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-active"
                        className="absolute inset-0 rounded-[var(--radius-md)] bg-raised shadow-[var(--shadow-xs)]"
                        transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
                      />
                    )}
                    <Icon className="relative size-4 shrink-0" aria-hidden />
                    <span className="relative">{label}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>

        <div className="border-t border-line-subtle p-3">
          <Link
            href="/settings"
            className={cn(
              "mb-2 flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-[13px] font-medium transition-colors",
              pathname.startsWith("/settings")
                ? "bg-raised text-ink"
                : "text-ink-3 hover:bg-[var(--surface-inset)] hover:text-ink-2",
            )}
          >
            <Settings className="size-4 shrink-0" aria-hidden />
            Settings
          </Link>
          <UserMenu user={user} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-30 flex h-14 items-center gap-3 border-b border-line-subtle bg-base/85 px-4 backdrop-blur-md md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className="rounded p-1.5 text-ink-2"
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <span className="text-[14px] font-semibold text-ink">Captivate</span>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
