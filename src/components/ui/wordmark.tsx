import { Sparkles } from "lucide-react";
import { cn } from "@/lib/utils/cn";

/**
 * The brand lockup: Captivate, the product, and Axtevi, the company it sits
 * under (`PROGRESS.md`).
 *
 * It lives in one place because it was in four — the app sidebar, the app's
 * narrow-screen header, the auth split and the public site — each with its own
 * size and its own colour tokens. A maker's mark that is only on three of the
 * four surfaces reads as an oversight rather than a name, and that is exactly
 * what copying the string a fifth time would have produced.
 *
 * The two names are set as a stack, not a run-on sentence: "Captivate" keeps
 * the size and weight it had, and "by Axtevi" sits under it small, spaced and
 * quiet. The product is what the reader came for; the company is the signature
 * beneath it. Inline, at 14px, the two collide into one long string in which
 * neither name is legible at a glance.
 */

/**
 * The public site paints on its own fixed palette — see `site-chrome.tsx`,
 * where the front door deliberately ignores the visitor's colour scheme — so
 * the lockup cannot simply use the app's semantic ink tokens everywhere.
 */
type Tone = "app" | "sky";

const TONE: Record<Tone, { icon: string; product: string; maker: string }> = {
  app: {
    icon: "text-white",
    product: "text-ink",
    maker: "text-ink-3",
  },
  sky: {
    icon: "text-white",
    product: "text-[var(--sky-ink)]",
    maker: "text-[var(--sky-ink-3)]",
  },
};

export function Wordmark({
  tone = "app",
  size = "sm",
  className,
}: {
  tone?: Tone;
  /** `sm` is a 56px header row; `md` is the auth split and the public site. */
  size?: "sm" | "md";
  className?: string;
}) {
  const palette = TONE[tone];
  const md = size === "md";

  return (
    <span className={cn("flex items-center gap-2.5", className)}>
      {/*
       * The tile carries the mark's own gradient rather than a flat accent:
       * the brand is a sweep from indigo to coral, and a single swatch of it
       * is the one part that is not the brand.
       */}
      <span
        className={cn(
          "flex items-center justify-center",
          md ? "size-8 rounded-[var(--radius-md)]" : "size-7 rounded-[var(--radius-sm)]",
        )}
        style={{ background: "var(--brand-gradient)" }}
      >
        <Sparkles className={cn(md ? "size-4" : "size-3.5", palette.icon)} aria-hidden />
      </span>

      {/*
       * `leading-none` on both lines, with the gap set explicitly: the default
       * line box adds descender space that puts the maker's line visibly lower
       * on the left of the tile than on the right, which is the difference
       * between a lockup and two things that happen to be next to each other.
       */}
      <span className="flex flex-col gap-[3px]">
        <span
          className={cn(
            "font-semibold tracking-tight",
            palette.product,
            md ? "text-[15px]" : "text-[14px]",
            "leading-none",
          )}
        >
          Captivate
        </span>
        <span
          className={cn(
            "font-medium uppercase",
            palette.maker,
            md ? "text-[9.5px] tracking-[0.16em]" : "text-[9px] tracking-[0.15em]",
            "leading-none",
          )}
        >
          by Axtevi
        </span>
      </span>
    </span>
  );
}
