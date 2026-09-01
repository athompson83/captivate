"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useId, useRef, useState } from "react";
import { cn } from "@/lib/utils/cn";
import { FieldCaptionContext } from "./input";

/* -------------------------------------------------------------------------- */
/* Tooltip                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Hover/focus tooltip. Purely supplementary: every control it wraps must also
 * carry its own accessible name, so losing the tooltip never loses meaning.
 */
export function Tooltip({
  label,
  shortcut,
  side = "bottom",
  children,
}: {
  label: string;
  shortcut?: string;
  side?: "top" | "bottom" | "left" | "right";
  children: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const show = () => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setOpen(true), 420);
  };
  const hide = () => {
    clearTimeout(timer.current);
    setOpen(false);
  };

  useEffect(() => () => clearTimeout(timer.current), []);

  const pos = {
    top: "bottom-full left-1/2 -translate-x-1/2 mb-2",
    bottom: "top-full left-1/2 -translate-x-1/2 mt-2",
    left: "right-full top-1/2 -translate-y-1/2 mr-2",
    right: "left-full top-1/2 -translate-y-1/2 ml-2",
  }[side];

  return (
    <span
      className="relative inline-flex"
      onPointerEnter={show}
      onPointerLeave={hide}
      onFocusCapture={() => setOpen(true)}
      onBlurCapture={hide}
    >
      {children}
      <AnimatePresence>
        {open && (
          <motion.span
            role="tooltip"
            initial={{ opacity: 0, scale: 0.94 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.96 }}
            transition={{ duration: 0.12 }}
            className={cn(
              "pointer-events-none absolute z-[80] flex items-center gap-2 whitespace-nowrap",
              "border-line bg-overlay text-ink rounded-[var(--radius-sm)] border px-2 py-1 text-xs shadow-[var(--shadow-md)]",
              pos,
            )}
          >
            {label}
            {shortcut && (
              <kbd className="border-line-subtle text-ink-3 rounded border bg-[var(--surface-inset)] px-1 font-sans text-[10px]">
                {shortcut}
              </kbd>
            )}
          </motion.span>
        )}
      </AnimatePresence>
    </span>
  );
}

/* -------------------------------------------------------------------------- */
/* Popover                                                                     */
/* -------------------------------------------------------------------------- */

export function Popover({
  open,
  onClose,
  anchor = "bottom-start",
  className,
  children,
}: {
  open: boolean;
  onClose: () => void;
  anchor?: "bottom-start" | "bottom-end" | "top-start" | "top-end";
  className?: string;
  children: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // Whatever opened this — the trigger, in every case in this codebase.
    restoreFocus.current = document.activeElement as HTMLElement | null;

    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    // Deferred so the click that opened the popover does not immediately close it.
    const t = setTimeout(() => document.addEventListener("pointerdown", onDown), 0);
    document.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(t);
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);

      // Escape used to drop focus on `body`, so the next Tab restarted at the
      // top of the document and a keyboard user lost their place entirely.
      // `Dialog` has restored focus since #41; this had the same hole and
      // every menu in the editor goes through it.
      //
      // Only when focus is still ours to give back. Dismissing by clicking
      // something else must leave focus where the click put it, and a menu
      // item that navigates has already moved it on purpose — stealing it
      // back to the trigger in either case is its own bug.
      const active = document.activeElement;
      const stranded = !active || active === document.body || ref.current?.contains(active);
      if (stranded) restoreFocus.current?.focus?.();
    };
  }, [open, onClose]);

  const pos = {
    "bottom-start": "top-full left-0 mt-2 origin-top-left",
    "bottom-end": "top-full right-0 mt-2 origin-top-right",
    "top-start": "bottom-full left-0 mb-2 origin-bottom-left",
    "top-end": "bottom-full right-0 mb-2 origin-bottom-right",
  }[anchor];

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          ref={ref}
          initial={{ opacity: 0, scale: 0.96, y: -4 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: -2 }}
          transition={{ duration: 0.15, ease: [0.22, 1, 0.36, 1] }}
          className={cn(
            "border-line bg-overlay absolute z-[70] rounded-[var(--radius-lg)] border p-1.5 shadow-[var(--shadow-lg)]",
            pos,
            className,
          )}
        >
          {children}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function MenuItem({
  icon: Icon,
  label,
  shortcut,
  onClick,
  tone = "default",
  disabled,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
  shortcut?: string;
  onClick?: () => void;
  tone?: "default" | "danger";
  disabled?: boolean;
}) {
  return (
    <button
      role="menuitem"
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex w-full items-center gap-2.5 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[13px]",
        "transition-colors duration-[var(--duration-instant)] disabled:pointer-events-none disabled:opacity-40",
        tone === "danger"
          ? "text-danger hover:bg-[var(--danger-soft)]"
          : "text-ink-2 hover:text-ink hover:bg-[var(--surface-inset)]",
      )}
    >
      {Icon && <Icon className="size-3.5 shrink-0" />}
      <span className="flex-1 truncate">{label}</span>
      {shortcut && <kbd className="text-ink-3 font-sans text-[10px]">{shortcut}</kbd>}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Small display components                                                    */
/* -------------------------------------------------------------------------- */

export function Badge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: "neutral" | "accent" | "ai" | "success" | "record" | "warning";
  children: React.ReactNode;
  className?: string;
}) {
  const tones = {
    neutral: "bg-[var(--surface-inset)] text-ink-3 border-line-subtle",
    accent: "bg-[var(--accent-soft)] text-accent-text border-transparent",
    ai: "bg-[var(--ai-soft)] text-ai-text border-transparent",
    success: "bg-[var(--success-soft)] text-success border-transparent",
    record: "bg-[var(--record-soft)] text-record border-transparent",
    warning: "bg-[var(--accent-soft)] text-warning border-transparent",
  }[tone];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-medium",
        tones,
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <span
      role="status"
      aria-label="Loading"
      className={cn(
        "border-line-strong border-t-accent inline-block size-4 animate-spin rounded-full border-2",
        className,
      )}
    />
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("skeleton rounded-[var(--radius-md)]", className)} />;
}

/**
 * `icon` is a rendered node, not a component type.
 *
 * A server component cannot hand a function across the client boundary, and
 * passing `icon={FileText}` from one throws at request time — which showed up
 * as a blank dashboard for exactly the users who had no presentations yet. An
 * element serialises, so both server and client callers can use this.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center px-6 py-16 text-center", className)}
    >
      <div className="border-line-subtle text-ink-3 mb-4 flex size-12 items-center justify-center rounded-[var(--radius-lg)] border bg-[var(--surface-inset)] [&>svg]:size-5">
        {icon}
      </div>
      <h3 className="text-ink text-[15px] font-semibold">{title}</h3>
      <p className="text-ink-3 mt-1.5 max-w-sm text-[13px] leading-relaxed">{description}</p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** Segmented control — used instead of dropdowns for 2–4 mutually exclusive options. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  size = "md",
  label,
  stretch,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: string; icon?: React.ComponentType<{ className?: string }> }[];
  size?: "sm" | "md";
  label?: string;
  /** Fill the width available and share it equally between the options. */
  stretch?: boolean;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn(
        "border-line-subtle items-center gap-0.5 rounded-[var(--radius-md)] border bg-[var(--surface-inset)] p-0.5",
        stretch ? "flex w-full" : "inline-flex",
      )}
    >
      {options.map((opt) => {
        const active = opt.value === value;
        const Icon = opt.icon;
        return (
          <button
            key={opt.value}
            role="radio"
            aria-checked={active}
            onClick={() => onChange(opt.value)}
            className={cn(
              "relative inline-flex items-center justify-center gap-1.5 rounded-[var(--radius-sm)] font-medium transition-colors duration-[var(--duration-fast)]",
              size === "sm" ? "px-2 py-1 text-[11px]" : "px-2.5 py-1.5 text-[12px]",
              // A touch target rather than a pointer one. The stretched form is
              // the narrow-screen layout, where this is the primary navigation
              // and a 22px-tall control is not something a thumb can hit.
              stretch && "flex-1 py-1.5 text-[12px]",
              active ? "text-ink" : "text-ink-3 hover:text-ink-2",
            )}
          >
            {active && (
              <motion.span
                layoutId={`seg-${label ?? "group"}`}
                className="bg-raised absolute inset-0 rounded-[var(--radius-sm)] shadow-[var(--shadow-xs)]"
                transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
              />
            )}
            {Icon && <Icon className="relative size-3.5" />}
            <span className="relative">{opt.label}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Field({ label, children }: { label: string; children: React.ReactNode }) {
  // The caption is a paragraph rather than a `<label>` because a Field may
  // hold several controls, or none — so it is published by id instead, and any
  // Input or Textarea inside that has no name of its own takes this one.
  const captionId = useId();
  return (
    <div>
      <p
        id={captionId}
        className="text-ink-3 mb-1.5 text-[10px] font-medium tracking-wider uppercase"
      >
        {label}
      </p>
      <FieldCaptionContext value={captionId}>{children}</FieldCaptionContext>
    </div>
  );
}

export function Slider({
  label,
  value,
  min,
  max,
  step,
  format,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
  onChange: (v: number) => void;
}) {
  return (
    <div>
      <div className="mb-1.5 flex items-baseline justify-between">
        <span className="text-ink-3 text-[10px] font-medium tracking-wider uppercase">{label}</span>
        <span className="text-ink-3 text-[11px] tabular-nums">{format(value)}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(Number(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[var(--surface-inset)] accent-[var(--accent)]"
      />
    </div>
  );
}

export function Toggle({
  label,
  hint,
  checked,
  onChange,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        // A wrapping `<label>` is not a naming source for a button, and this
        // one's whole subtree is an empty thumb — so it announced as
        // "switch, off" with no hint of what it switches.
        aria-label={label}
        onClick={() => onChange(!checked)}
        className={cn(
          "mt-0.5 h-4 w-7 shrink-0 rounded-full p-0.5 transition-colors",
          checked ? "bg-accent" : "bg-[var(--border-default)]",
        )}
      >
        <span
          className={cn(
            "block size-3 rounded-full bg-white transition-transform",
            checked && "translate-x-3",
          )}
        />
      </button>
      <span className="min-w-0">
        <span className="text-ink block text-[12px]">{label}</span>
        {hint && <span className="text-ink-3 mt-0.5 block text-[11px] leading-snug">{hint}</span>}
      </span>
    </label>
  );
}
