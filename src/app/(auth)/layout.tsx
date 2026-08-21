import Link from "next/link";
import { Sparkles } from "lucide-react";

/**
 * Split auth layout: the form on the left, a live "stage" motif on the right
 * that shows what the product is before the user has an account.
 */
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
      <div className="flex flex-col px-6 py-8 sm:px-10 lg:px-16">
        <Link href="/" className="inline-flex w-fit items-center gap-2.5">
          <span className="bg-accent flex size-8 items-center justify-center rounded-[var(--radius-md)]">
            <Sparkles className="size-4 text-[var(--accent-contrast)]" aria-hidden />
          </span>
          <span className="text-ink text-[15px] font-semibold tracking-tight">Captivate</span>
        </Link>

        <div className="flex flex-1 items-center py-12">
          <div className="w-full max-w-sm">{children}</div>
        </div>

        <p className="text-ink-3 text-xs">Captivate — presentations that hold a room.</p>
      </div>

      <div className="bg-sunken relative hidden overflow-hidden lg:block">
        <StageMotif />
      </div>
    </div>
  );
}

/** A still frame of the product's visual language: dark stage, warm light. */
function StageMotif() {
  return (
    <div className="absolute inset-0 flex items-center justify-center p-12">
      <div
        aria-hidden
        className="absolute inset-0"
        style={{
          background:
            "radial-gradient(120% 80% at 50% -10%, var(--accent-soft) 0%, transparent 55%), var(--surface-sunken)",
        }}
      />
      <div className="relative w-full max-w-xl">
        <div
          className="border-line aspect-video w-full overflow-hidden rounded-[var(--radius-2xl)] border shadow-[var(--shadow-xl)]"
          style={{ background: "radial-gradient(120% 90% at 50% 0%, #191C26 0%, #0F1117 62%)" }}
        >
          <div className="flex h-full flex-col justify-end p-10">
            <p className="text-[11px] font-medium tracking-[0.18em] text-[#F0B858] uppercase">
              Chapter 02
            </p>
            <h2
              className="mt-3 text-4xl leading-[1.08] font-semibold text-[#F5F6F8]"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Recognising shock before the blood pressure falls
            </h2>
            <p className="mt-4 max-w-md text-sm leading-relaxed text-[#9AA0AE]">
              Compensated shock is a clinical diagnosis, not a numerical one.
            </p>
          </div>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3">
          {[
            ["Present", "Full-screen stage with no editor chrome"],
            ["Annotate", "Laser, highlight and ink over live content"],
            ["Record", "Screen, microphone and camera in one file"],
          ].map(([title, body]) => (
            <div
              key={title}
              className="border-line-subtle bg-raised/60 rounded-[var(--radius-lg)] border p-3.5"
            >
              <p className="text-ink text-[12px] font-semibold">{title}</p>
              <p className="text-ink-3 mt-1 text-[11px] leading-snug">{body}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
