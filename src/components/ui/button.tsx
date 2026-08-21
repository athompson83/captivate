"use client";

import { forwardRef } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type Variant = "primary" | "secondary" | "ghost" | "subtle" | "danger" | "ai" | "record";
type Size = "xs" | "sm" | "md" | "lg";

const VARIANTS: Record<Variant, string> = {
  primary:
    "bg-accent text-[var(--accent-contrast)] hover:bg-accent-hover shadow-[var(--shadow-sm)] active:translate-y-px",
  secondary:
    "bg-raised text-ink border border-line hover:border-line-strong hover:bg-overlay active:translate-y-px",
  ghost: "text-ink-2 hover:text-ink hover:bg-[var(--surface-inset)]",
  subtle: "bg-[var(--surface-inset)] text-ink-2 hover:text-ink hover:bg-overlay",
  danger: "bg-danger text-white hover:opacity-90 active:translate-y-px",
  ai: "bg-ai text-white hover:opacity-90 shadow-[var(--shadow-sm)] active:translate-y-px",
  record: "bg-record text-white hover:opacity-90 shadow-[var(--shadow-sm)] active:translate-y-px",
};

const SIZES: Record<Size, string> = {
  xs: "h-7 px-2 text-xs gap-1.5 rounded-[var(--radius-sm)]",
  sm: "h-8 px-3 text-[13px] gap-1.5 rounded-[var(--radius-sm)]",
  md: "h-10 px-4 text-sm gap-2 rounded-[var(--radius-md)]",
  lg: "h-12 px-6 text-[15px] gap-2 rounded-[var(--radius-lg)]",
};

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  loading?: boolean;
  iconOnly?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant = "secondary", size = "md", loading, iconOnly, children, disabled, ...props },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      // aria-busy so assistive tech announces the pending state; the spinner
      // alone is not perceivable.
      aria-busy={loading || undefined}
      className={cn(
        "relative inline-flex items-center justify-center font-medium whitespace-nowrap",
        "transition-[background-color,border-color,color,box-shadow,transform] duration-[var(--duration-fast)]",
        "disabled:pointer-events-none disabled:opacity-45",
        VARIANTS[variant],
        SIZES[size],
        iconOnly && "aspect-square px-0",
        className,
      )}
      {...props}
    >
      {loading && <Loader2 className="size-4 animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
