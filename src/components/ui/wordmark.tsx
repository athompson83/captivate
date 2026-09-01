import Image from "next/image";
import mark from "../../../public/brand/captivate-icon.png";
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
 * The symbol is the artwork from the brand kit; the two names are set in live
 * type. That split is deliberate. The ribbon is three hue turns and a fold —
 * nothing CSS can draw — while a picture of the words would be fixed at one
 * colour, and the words have to be legible on a dark canvas, on paper, and on
 * the public site's own fixed palette. The kit's own logo page does the same:
 * one symbol, and the endorsement set beneath it.
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

const TONE: Record<Tone, { product: string; maker: string }> = {
  app: {
    product: "text-ink",
    maker: "text-ink-3",
  },
  sky: {
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
       * The symbol carries its own ground and its own corner radius, so it is
       * drawn rather than framed: a tile inside a tile reads as a favicon that
       * has been pasted into the page. `alt` is empty because the names are
       * right beside it — the kit's mark is not a second label.
       *
       * The kit's floor for the symbol is 24px, which both sizes clear.
       */}
      <Image
        src={mark}
        alt=""
        width={md ? 32 : 28}
        height={md ? 32 : 28}
        className={cn("shrink-0", md ? "size-8" : "size-7")}
        priority
      />

      {/*
       * `leading-none` on both lines, with the gap set explicitly: the default
       * line box adds descender space that puts the maker's line visibly lower
       * on the left of the symbol than on the right, which is the difference
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
          // Manrope, the kit's display face — the logotype is a geometric sans
          // and the interface face is not.
          style={{ fontFamily: "var(--font-display)" }}
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
