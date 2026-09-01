/**
 * The real `Dialog`, mounted with something focusable behind it.
 *
 * A focus trap can only be tested where focus can actually escape, which means
 * a real browser and a real page with tabbable content outside the modal. The
 * page below supplies exactly that: three buttons that belong to the page, and
 * a dialog over them whose own controls are the only ones a keyboard should be
 * able to reach while it is open.
 *
 * Two variants, because which direction leaks depends on the layout. Clicking
 * a dialog's prose puts focus on nothing, and Chromium then resumes tabbing
 * from the clicked node — so the escape is backwards when the prose sits above
 * the panel's last control, and forwards when it sits below it. `?variant=`
 * selects between them:
 *
 * - default — header, prose, footer buttons. Prose is above the last control,
 *   so **Shift+Tab** is the way out. This is `ConfirmDialog`, the rename
 *   dialog and the template dialog.
 * - `nofooter` — header and prose only, no trailing controls. Prose is below
 *   the last control, so **Tab** is the way out. This is the share dialog, the
 *   editor's shortcut dialog and the recording detail dialog.
 *
 * Bundled by `tests/e2e/dialog-focus.spec.ts` at test time and imported by
 * nothing under `src/`, so none of it reaches a production build.
 */

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Dialog } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

declare global {
  interface Window {
    /** Where focus is now, as a test can read it: the element's accessible label. */
    focusLabel: () => string;
    /** Whether focus is anywhere inside the dialog panel. */
    focusInsideDialog: () => boolean;
  }
}

function Harness({ footer }: { footer: boolean }) {
  const [open, setOpen] = useState(true);

  return (
    <div>
      {/* The page behind the modal. A keyboard must not reach any of these. */}
      <button data-behind="1">Behind one</button>
      <button data-behind="2">Behind two</button>
      <button data-behind="3">Behind three</button>

      <Dialog
        open={open}
        onClose={() => setOpen(false)}
        title="A dialog with prose in it"
        description="Clicking this sentence is what moves focus to nothing."
        footer={
          footer ? (
            <>
              <Button size="sm" onClick={() => setOpen(false)} data-autofocus>
                Cancel
              </Button>
              <Button size="sm" onClick={() => setOpen(false)}>
                Confirm
              </Button>
            </>
          ) : undefined
        }
      >
        {footer ? undefined : (
          // Tall on purpose: a test needs somewhere to click that is inside
          // the panel, below every control, and unambiguously not on one.
          // Inline rather than a utility class, because Tailwind scans `src/`
          // and not this directory — a class here compiles to nothing, and the
          // paragraph is then one line tall with no room to click in.
          <p data-prose style={{ paddingBottom: 120 }}>
            Body prose with room below it, the way a share dialog reads.
          </p>
        )}
      </Dialog>
    </div>
  );
}

const host = document.createElement("div");
document.body.append(host);

window.focusLabel = () => {
  const el = document.activeElement as HTMLElement | null;
  if (!el || el === document.body) return "(body)";
  return el.getAttribute("aria-label") ?? el.textContent?.trim() ?? el.tagName;
};

window.focusInsideDialog = () => {
  const panel = document.querySelector('[role="dialog"]');
  const el = document.activeElement;
  return Boolean(panel && el && panel.contains(el));
};

createRoot(host).render(
  <StrictMode>
    <Harness footer={!new URLSearchParams(location.search).has("nofooter")} />
  </StrictMode>,
);
