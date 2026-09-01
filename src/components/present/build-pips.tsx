import { cn } from "@/lib/utils/cn";

/**
 * The most presses this will draw one pip each for.
 *
 * Past it the row says the number instead. Nineteen dots is not glanceable
 * either — the whole argument for pips is that a length is judged without
 * counting, and a length nobody can judge is just a worse numeral — and a
 * scene with that many builds has a problem this component should not tidy
 * away into a neat row.
 */
const MAX_PIPS = 8;

export interface BuildPipsProps {
  /** How many presses this scene takes in total, including arriving on it. */
  total: number;
  /** Which press the presenter is on, zero-based. */
  current: number;
  /** Dark surfaces (the phone remote) tint from white rather than from ink. */
  tone?: "console" | "dark";
  className?: string;
}

/**
 * How far through a scene's builds the presenter is, as a row of pips.
 *
 * Both surfaces already said this in words — "2 more presses on this scene",
 * "+2 builds here" — and words are the wrong shape for it. A presenter reads
 * this while talking, in peripheral vision, in the half-second between
 * finishing a sentence and reaching for the key. A count has to be *read*: the
 * eye lands, parses a numeral, parses a noun, and comes back. A row of pips is
 * a length, and a length is judged without reading.
 *
 * Filled means spent, hollow means left, and the pip about to be spent is
 * ringed — so "does the next press change the slide" and "how much of this is
 * left" are one glance rather than two.
 *
 * The words stay beside it on both surfaces. This is a second reading of the
 * same fact, not a replacement for it.
 */
export function BuildPips({ total, current, tone = "console", className }: BuildPipsProps) {
  const left = Math.max(0, total - 1 - current);

  // A scene that does not build has nothing to say here. Drawing a single pip
  // on every scene would make the row furniture, and furniture stops being
  // looked at — which costs the scenes that do build.
  if (total <= 1) return null;

  const label = `${left} of ${total - 1} ${total - 1 === 1 ? "build" : "builds"} left on this scene`;

  if (total - 1 > MAX_PIPS) {
    return (
      <span
        className={cn(
          "text-[11px] font-medium tabular-nums",
          tone === "dark" ? "text-white/60" : "text-accent-text",
          className,
        )}
        aria-live="polite"
      >
        {label}
      </span>
    );
  }

  return (
    <span
      className={cn("inline-flex items-center gap-[3px]", className)}
      // One label for the row, and the pips hidden from it. A screen reader
      // announcing eight dots is worse than announcing nothing.
      role="img"
      aria-label={label}
      aria-live="polite"
    >
      {Array.from({ length: total - 1 }, (_, index) => {
        const spent = index < current;
        const next = index === current;
        return (
          <span
            key={index}
            aria-hidden
            className={cn(
              "size-[5px] rounded-full transition-colors",
              // The pip the next press will spend, ringed rather than filled,
              // so it reads as "here" without competing with the spent ones.
              next && "ring-[1.5px] ring-offset-0",
              tone === "dark"
                ? spent
                  ? "bg-white/70"
                  : next
                    ? "bg-white/25 ring-white/80"
                    : "bg-white/25"
                : spent
                  ? "bg-accent"
                  : next
                    ? "ring-accent bg-transparent"
                    : "bg-line",
            )}
          />
        );
      })}
    </span>
  );
}
