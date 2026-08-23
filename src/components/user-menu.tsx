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
        <span className="text-accent-text flex size-7 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[11px] font-semibold">
          {initials || <User className="size-3.5" aria-hidden />}
        </span>
        <span className="min-w-0 flex-1">
          <span className="text-ink block truncate text-[12.5px] font-medium">
            {user.displayName}
          </span>
          <span className="text-ink-3 block truncate text-[11px]">{user.email}</span>
        </span>
      </button>

      <Popover open={open} onClose={() => setOpen(false)} anchor="top-start" className="w-[228px]">
        <div role="menu">
          <Link href="/settings" onClick={() => setOpen(false)}>
            <MenuItem icon={User} label="Account settings" />
          </Link>

          <div className="border-line-subtle my-1.5 border-t" />
          <p className="text-ink-3 px-2.5 pb-1 text-[10px] font-medium tracking-wider uppercase">
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
              className="text-ink-2 hover:text-ink flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-[13px] transition-colors hover:bg-[var(--surface-inset)]"
            >
              <Icon className="size-3.5" aria-hidden />
              <span className="flex-1 text-left">{label}</span>
              {pref === value && <span className="bg-accent size-1.5 rounded-full" aria-hidden />}
            </button>
          ))}

          <div className="border-line-subtle my-1.5 border-t" />
          <form action="/auth/sign-out" method="post">
            <button
              type="submit"
              role="menuitem"
              className="text-ink-2 hover:text-ink flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px] transition-colors hover:bg-[var(--surface-inset)]"
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
