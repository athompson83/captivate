"use client";

import { useEffect } from "react";
import { AlertTriangle, RotateCw } from "lucide-react";

/**
 * What a signed-in page does when it throws on the server.
 *
 * Without this, Next renders its own bare "This page couldn't load" — no
 * navigation, no way back, and nothing the person looking at it can tell
 * anyone. Every route in this group loads the user's own work, so a failure
 * here is nearly always one bad row rather than a broken deployment: the rest
 * of the library is still there and still reachable.
 *
 * The digest is shown deliberately. It is the only identifier that ties what
 * someone saw to the line that threw, and asking for a screenshot of a blank
 * error page has no answer.
 */
export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    // Server errors reach the browser stripped of their message; the digest is
    // what matches this up with the server log.
    console.error("Captivate page error", error.digest ?? "", error);
  }, [error]);

  return (
    <div className="app-page">
      <div className="border-line-subtle mx-auto max-w-lg rounded-[var(--radius-lg)] border bg-[var(--surface-raised)] p-6 text-center">
        <AlertTriangle className="text-ink-3 mx-auto size-6" aria-hidden />
        <h1 className="text-ink mt-3 text-[16px] font-medium">This page didn&apos;t load</h1>
        <p className="text-ink-3 mt-1.5 text-[13.5px] leading-relaxed">
          Something went wrong reading your work — not writing it. Nothing has been changed or
          lost, and the rest of Captivate is still available in the sidebar.
        </p>

        <button
          onClick={reset}
          className="border-line text-ink-2 hover:text-ink mt-5 inline-flex min-h-9 items-center gap-1.5 rounded-[var(--radius-md)] border px-4 text-[13px] font-medium transition-colors"
        >
          <RotateCw className="size-3.5" aria-hidden />
          Try again
        </button>

        {error.digest && (
          <p className="text-ink-3 mt-4 font-mono text-[11px]">
            Reference {error.digest}
          </p>
        )}
      </div>
    </div>
  );
}
