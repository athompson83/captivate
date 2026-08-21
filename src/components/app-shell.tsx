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
    <div className="bg-base flex min-h-screen">
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
          "border-line-subtle bg-sunken fixed inset-y-0 left-0 z-50 flex w-[248px] shrink-0 flex-col border-r",
          "transition-transform duration-[var(--duration-base)] ease-[var(--ease-out-quint)] md:sticky md:top-0 md:h-screen md:translate-x-0",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
        )}
      >
        <div className="flex h-14 items-center justify-between px-4">
          <Link
            href="/home"
            onClick={() => setMobileOpen(false)}
            className="flex items-center gap-2.5"
          >
            <span className="bg-accent flex size-7 items-center justify-center rounded-[var(--radius-sm)]">
              <Sparkles className="size-3.5 text-[var(--accent-contrast)]" aria-hidden />
            </span>
            <span className="text-ink text-[14px] font-semibold tracking-tight">Captivate</span>
          </Link>
          <button
            onClick={() => setMobileOpen(false)}
            aria-label="Close navigation"
            className="text-ink-3 rounded p-1 md:hidden"
          >
            <X className="size-4" aria-hidden />
          </button>
        </div>

        <button
          onClick={() => setPaletteOpen(true)}
          className="border-line-subtle text-ink-3 hover:border-line hover:text-ink-2 mx-3 mb-3 flex items-center gap-2 rounded-[var(--radius-md)] border bg-[var(--surface-inset)] px-2.5 py-2 text-left text-[13px] transition-colors"
        >
          <span className="flex-1">Search or jump to…</span>
          <kbd className="border-line-subtle rounded border px-1 font-sans text-[10px]">⌘K</kbd>
        </button>

        <nav
          aria-label="Main"
          className="flex-1 overflow-y-auto px-3 pb-4"
          onClick={() => setMobileOpen(false)}
        >
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
                      active
                        ? "text-ink"
                        : "text-ink-3 hover:text-ink-2 hover:bg-[var(--surface-inset)]",
                    )}
                  >
                    {active && (
                      <motion.span
                        layoutId="nav-active"
                        className="bg-raised absolute inset-0 rounded-[var(--radius-md)] shadow-[var(--shadow-xs)]"
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

        <div className="border-line-subtle border-t p-3">
          <Link
            href="/settings"
            onClick={() => setMobileOpen(false)}
            className={cn(
              "mb-2 flex items-center gap-2.5 rounded-[var(--radius-md)] px-2.5 py-2 text-[13px] font-medium transition-colors",
              pathname.startsWith("/settings")
                ? "bg-raised text-ink"
                : "text-ink-3 hover:text-ink-2 hover:bg-[var(--surface-inset)]",
            )}
          >
            <Settings className="size-4 shrink-0" aria-hidden />
            Settings
          </Link>
          <UserMenu user={user} />
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-line-subtle bg-base/85 sticky top-0 z-30 flex h-14 items-center gap-3 border-b px-4 backdrop-blur-md md:hidden">
          <button
            onClick={() => setMobileOpen(true)}
            aria-label="Open navigation"
            className="text-ink-2 rounded p-1.5"
          >
            <Menu className="size-5" aria-hidden />
          </button>
          <span className="text-ink text-[14px] font-semibold">Captivate</span>
        </header>

        <main className="min-w-0 flex-1">{children}</main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
