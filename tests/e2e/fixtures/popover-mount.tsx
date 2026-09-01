/**
 * The real `Popover`, anchored where a window edge is in the way.
 *
 * Whether a panel stays inside the window is measured geometry under a real
 * layout engine, and the correction is written straight to the element rather
 * than into state — so there is nothing to assert but the rendered box. jsdom
 * can answer none of it.
 *
 * The editor's own top-anchored menus each cap themselves at `46vh`, which is
 * why the arithmetic error this fixture exists for was invisible in the
 * product: room measured downwards from a panel that grows *upwards* reports
 * more space than the window has, and only a panel taller than the room above
 * its trigger can show it. `?variant=` places the trigger where each edge
 * bites:
 *
 * - `top` — trigger at the bottom of a short window, panel taller than the
 *   space above it. Room measured the old way is `innerHeight - box.top`,
 *   which grows as the panel runs further off the top.
 * - `bottom` — trigger at the top, panel taller than the space below it.
 * - `end` — trigger near the left edge with an end-anchored panel wider than
 *   the space to its left, which is the 320px overflow-menu case.
 *
 * Bundled by `tests/e2e/editor-narrow.spec.ts` at test time and imported by
 * nothing under `src/`, so none of it reaches a production build.
 */

import { StrictMode, useState } from "react";
import { createRoot } from "react-dom/client";
import { Popover } from "@/components/ui/misc";

type Variant = "top" | "bottom" | "end";

function Harness({ variant }: { variant: Variant }) {
  const [open, setOpen] = useState(true);

  const anchor =
    variant === "top" ? "top-start" : variant === "end" ? "bottom-end" : "bottom-start";

  // Twenty rows of a real height, so the panel is taller than any short window
  // this is opened in and the cap has something to bite on.
  const rows = Array.from({ length: 20 }, (_, index) => index);

  return (
    <div
      style={{
        position: "absolute",
        // `top` puts the trigger at the bottom of the window; the others put it
        // at the top, and `end` pins it to the left so a right-anchored panel
        // hangs off that side.
        [variant === "top" ? "bottom" : "top"]: "8px",
        left: "8px",
        width: "40px",
      }}
    >
      <div style={{ position: "relative" }}>
        <button type="button" onClick={() => setOpen((was) => !was)}>
          Open
        </button>
        <Popover open={open} onClose={() => setOpen(false)} anchor={anchor} className="w-[260px]">
          <div data-panel-body>
            {rows.map((index) => (
              <button key={index} type="button" style={{ display: "block", height: 32 }}>
                Row {index}
              </button>
            ))}
          </div>
        </Popover>
      </div>
    </div>
  );
}

const variant = (new URLSearchParams(location.search).get("variant") ?? "top") as Variant;

// The bundled page is a bare document; the host is ours to make.
const host = document.createElement("div");
document.body.append(host);
document.body.style.margin = "0";

createRoot(host).render(
  <StrictMode>
    <Harness variant={variant} />
  </StrictMode>,
);

document.body.dataset.ready = "true";
