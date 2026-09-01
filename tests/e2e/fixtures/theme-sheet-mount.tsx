import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import { Stage } from "@/components/stage/stage";
import { THEMES } from "@/lib/schema/theme";
import { composeScene } from "@/lib/editor/layouts";
import { STAGE_BASE_WIDTH } from "@/lib/present/stage";

const CELL = 440;

/**
 * Every theme, rendered.
 *
 * The theme set is guarded by measured contrast — AAA for ink, AA for muted
 * and for text on the accent — and that is a floor, not a look. A palette can
 * clear every ratio and still be muddy, or have an accent that reads as an
 * error state, or a surface indistinguishable from its canvas. None of that
 * is visible in a number, so this draws the same three scenes in each theme
 * and lets somebody look at them.
 *
 * Three scenes rather than one, because a theme fails in different places: a
 * statement shows the display face and the accent clause, bullets show muted
 * text and rhythm, and a callout-and-code scene shows the secondary surface,
 * which is the token most often left too close to the canvas.
 */

const SCENES = [
  composeScene("statement", {
    eyebrow: "Chapter 02",
    heading: "Shock is a clinical diagnosis,",
    headingAccent: "not a numerical one.",
  }),
  composeScene("bullets", {
    heading: "What you are actually looking for",
    bullets: [
      "Perfusion, not pressure",
      "Skin, capillary refill, mentation",
      "A narrowing pulse pressure",
      "The patient who looks wrong",
    ],
  }),
  composeScene("chart", {
    heading: "Mortality rises with every hour",
    chart: {
      chart: "column",
      data: [
        { label: "0–1h", value: 6 },
        { label: "1–2h", value: 14 },
        { label: "2–3h", value: 27 },
        { label: "3h+", value: 41 },
      ],
    },
    caption: "Time to recognition, not time to treatment.",
  }),
];

function Sheet() {
  return (
    <div style={{ padding: 24, background: "#0b0b0d", fontFamily: "system-ui, sans-serif" }}>
      {THEMES.map((theme) => (
        <section key={theme.id} data-sheet-cell style={{ marginBottom: 28 }}>
          <header style={{ display: "flex", alignItems: "baseline", gap: 12, marginBottom: 8 }}>
            <h2
              data-sheet-label
              style={{ margin: 0, fontSize: 15, color: "#fff", fontWeight: 600 }}
            >
              {theme.name}
            </h2>
            <span style={{ fontSize: 12, color: "#8b8b96" }}>
              {theme.id} · {theme.mode} · {theme.description}
            </span>
          </header>
          <div style={{ display: "grid", gridTemplateColumns: `repeat(3, ${CELL}px)`, gap: 12 }}>
            {SCENES.map((content, i) => (
              <div key={i} style={{ width: CELL, height: Math.round(CELL / (16 / 9)) }}>
                {/* Fixed scale rather than measured: a contact sheet has no
                    resize to observe, and a scale of zero renders nothing. */}
                <Stage
                  content={content}
                  theme={theme}
                  aspect="16:9"
                  surface="card"
                  // The stage's root is `relative` with an absolutely
                  // positioned child, so it collapses to nothing unless its
                  // caller gives it a height — every real call site does.
                  className="h-full w-full rounded-[6px]"
                  fixedScale={CELL / STAGE_BASE_WIDTH}
                />
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  );
}

const host = document.createElement("div");
document.body.appendChild(host);
createRoot(host).render(<Sheet />);
document.body.dataset.ready = "true";
