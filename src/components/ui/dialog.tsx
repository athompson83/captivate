"use client";

import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils/cn";
import { Button } from "./button";

/**
 * A focused modal used sparingly — for destructive confirmation and for the
 * few flows that genuinely need to interrupt. Everything else in Captivate is
 * an inline or contextual surface.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  size = "md",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children?: React.ReactNode;
  footer?: React.ReactNode;
  size?: "sm" | "md" | "lg";
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocus = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    restoreFocus.current = document.activeElement as HTMLElement | null;

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== "Tab" || !panelRef.current) return;

      // Focus trap: keep Tab inside the dialog while it is open.
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKey, true);
    const t = setTimeout(() => {
      panelRef.current
        ?.querySelector<HTMLElement>("[data-autofocus],button,input,textarea")
        ?.focus();
    }, 40);

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.removeEventListener("keydown", onKey, true);
      clearTimeout(t);
      document.body.style.overflow = prevOverflow;
      restoreFocus.current?.focus?.();
    };
    // Deliberately keyed on `open` alone. Every caller passes an inline
    // `onClose`, so listing it re-ran this on any parent render: pressing
    // Delete flipped a `loading` prop, the cleanup threw focus back to the
    // button behind the dialog and released the page scroll, and forty
    // milliseconds later focus was dragged into the dialog again — mid
    // operation, with a screen reader announcing the wrong thing twice.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- see above
  }, [open]);

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center p-4">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.16 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
          />
          <motion.div
            ref={panelRef}
            role="dialog"
            aria-modal="true"
            aria-label={title}
            initial={{ opacity: 0, scale: 0.97, y: 12 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: 6 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            className={cn(
              "border-line bg-overlay relative w-full rounded-[var(--radius-xl)] border shadow-[var(--shadow-xl)]",
              size === "sm" && "max-w-sm",
              size === "md" && "max-w-md",
              size === "lg" && "max-w-2xl",
            )}
          >
            <div className="flex items-start justify-between gap-4 px-6 pt-5">
              <div className="min-w-0">
                <h2 className="text-ink text-[15px] font-semibold">{title}</h2>
                {description && (
                  <p className="text-ink-3 mt-1 text-[13px] leading-relaxed">{description}</p>
                )}
              </div>
              <Button
                variant="ghost"
                size="xs"
                iconOnly
                onClick={onClose}
                aria-label="Close dialog"
                className="-mt-1 -mr-2"
              >
                <X className="size-4" aria-hidden />
              </Button>
            </div>
            {children && <div className="px-6 py-4">{children}</div>}
            {footer && (
              <div className="border-line-subtle flex justify-end gap-2 border-t px-6 py-4">
                {footer}
              </div>
            )}
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/** Destructive confirmation. Never auto-focuses the destructive action. */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  description,
  confirmLabel = "Delete",
  tone = "danger",
  loading,
}: {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description: string;
  confirmLabel?: string;
  tone?: "danger" | "primary";
  loading?: boolean;
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      description={description}
      size="sm"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose} data-autofocus>
            Cancel
          </Button>
          <Button variant={tone} size="sm" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
