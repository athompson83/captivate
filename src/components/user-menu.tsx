"use client";

import { useState } from "react";
import Link from "next/link";
import { LogOut, Monitor, Moon, Sun, User } from "lucide-react";
import { Popover, MenuItem } from "@/components/ui/misc";
import { useTheme } from "@/components/ui/theme-provider";

export function UserMenu({
  user,
}: {
  user: { email: string; displayName: string; avatarUrl: string | null };
}) {
  const [open, setOpen] = useState(false);
  const { pref, setPref } = useTheme();

  const initials = user.displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex w-full items-center gap-2.5 rounded-[var(--radius-md)] px-2 py-1.5 text-left transition-colors hover:bg-[var(--surface-inset)]"
      >
        <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[11px] font-semibold text-accent-text">
          {initials || <User className="size-3.5" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[12.5px] font-medium text-ink">
            {user.displayName}
          </span>
          <span className="block truncate text-[11px] text-ink-3">{user.email}</span>
        </span>
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchor="top-start" className="w-[228px]">
        <div role="menu">
          <Link href="/settings" onClick={() => setOpen(false)}>
            <MenuItem icon={User} label="Account settings" />
          </Link>

          <div className="my-1.5 border-t border-line-subtle" />
          <p className="px-2.5 pb-1 text-[10px] font-medium uppercase tracking-wider text-ink-3">
            Appearance
          </p>
          {(
            [
              ["system", "System", Monitor],
              ["light", "Light", Sun],
              ["dark", "Dark", Moon],
            ] as const
          ).map(([value, label, Icon]) => (
            <button
              key={value}
              role="menuitemradio"
              aria-checked={pref === value}
              onClick={() => setPref(value)}
              className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[13px] text-ink-2 transition-colors hover:bg-[var(--surface-inset)] hover:text-ink"
            >
              <Icon className="size-3.5" aria-hidden />
              <span className="flex-1 text-left">{label}</span>
              {pref === value && <span className="size-1.5 rounded-full bg-accent" aria-hidden />}
            </button>
          ))}

          <div className="my-1.5 border-t border-line-subtle" />
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              role="menuitem"
              className="flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] text-ink-2 transition-colors hover:bg-[var(--surface-inset)] hover:text-ink"
            >
              <LogOut className="size-3.5" aria-hidden />
              Sign out
            </button>
          </form>
        </div>
      </Popover>
    </div>
  );
}
