import { createRoot } from "react-dom/client";
import "@/app/globals.css";
import { Stage } from "@/components/stage/stage";
import { getTheme } from "@/lib/schema/theme";
import { composeScene, settleCover, type LayoutContent } from "@/lib/editor/layouts";
import { STAGE_BASE_WIDTH } from "@/lib/present/stage";
import type { SceneLayout } from "@/lib/schema/presentation";

/**
 * Every named layout, drawn with plausible content.
 *
 * The layouts are what every template, every generated deck and every "change
 * layout" click produce, so a composition flaw in one of them is a flaw in
 * almost every presentation the product makes. None of that is visible in a
 * unit test — `composeScene` returning a valid `SceneContent` says nothing
 * about whether the result is balanced on a projector.
 *
 * Content lengths are deliberately ordinary rather than minimal: the failure
 * being looked for is a layout that strands its content in a corner, and a
 * one-word heading hides it.
 */

const CELL = 520;
const THEME = getTheme("midnight");

const CONTENT: Record<string, LayoutContent> = {
  title: {
    eyebrow: "Chapter 02",
    heading: "Recognising shock before the blood pressure falls",
    subheading: "A 50-minute session for second-year paramedic students.",
  },
  section: { eyebrow: "Movement 2", heading: "What the body does first" },
  statement: {
    heading: "Shock is a clinical diagnosis,",
    headingAccent: "not a numerical one.",
  },
  bullets: {
    heading: "What you are actually looking for",
    bullets: [
      "Perfusion, not pressure",
      "Skin, capillary refill, mentation",
      "A narrowing pulse pressure",
      "The patient who simply looks wrong",
    ],
  },
  "two-column": {
    heading: "Compensated against decompensated",
    bullets: ["Normal pressure", "Tachycardia", "Cool peripheries"],
    bulletsB: ["Falling pressure", "Altered mentation", "Mottling"],
  },
  "three-up": {
    heading: "Three things to check first",
    cards: [
      { title: "Skin", body: "Colour, temperature and whether it is wet.", icon: "circle" },
      { title: "Mentation", body: "Any change from their own baseline.", icon: "circle" },
      {
        title: "Refill",
        // Deliberately long. A layout only fails when its content runs longer
        // than whoever designed it expected, so one card here carries a real
        // sentence rather than a label.
        body: "Central rather than peripheral, timed properly, and read against this patient's own baseline rather than a textbook number that was never about them.",
        icon: "circle",
      },
    ],
  },
  quote: {
    quote: "The blood pressure is the last thing to go, and the first thing we look at.",
    attribution: "Every resuscitation textbook, eventually",
  },
  chart: {
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
  },
  code: {
    heading: "The shock index",
    code: {
      code: "shockIndex = heartRate / systolicBP;\n// > 0.9 is abnormal at any age",
      language: "ts",
    },
  },
  "split-left": {
    heading: "What the skin tells you",
    bullets: ["Mottling starts at the knee", "It moves proximally", "It is late"],
    media: { url: "", alt: "" },
  },
  "split-right": {
    heading: "What the skin tells you",
    bullets: ["Mottling starts at the knee", "It moves proximally", "It is late"],
    media: { url: "", alt: "" },
  },
  "media-full": {
    heading: "The patient who looks wrong",
    media: { url: "", alt: "" },
    caption: "A photograph belongs here.",
  },
  cover: {
    heading: "Recognising shock",
    subheading: "Before the pressure falls",
    media: { url: "", alt: "" },
  },
  closing: {
    heading: "What to take away",
    bullets: ["Treat perfusion, not numbers", "Trust the skin", "Escalate early"],
  },
  custom: { heading: "Custom", body: "An author-arranged scene." },
};

/**
 * The same layouts, given bullets of the length a model actually writes.
 *
 * The sheet above is phrases — "Tachycardia", "Cool peripheries" — which is
 * content a list fit can never fail on, so the overflow guard passed for the
 * whole time the fit was broken. These are bullets from the deck that was
 * being presented when text was reported running off the bottom of the frame,
 * verbatim, plus one item with an authored line break: `Runs` renders a
 * newline as a `<br>`, and a fit that counts characters cannot see one.
 */
const LONG: Partial<Record<SceneLayout, LayoutContent>> = {
  bullets: {
    heading: "Everyone is bolting a chatbot onto their product",
    bullets: [
      "It starts from the tool, not the problem.",
      "It treats AI as a feature to bolt on somewhere convenient.",
      "It ends in a chatbot, a summary button, or an AI-powered badge.",
      "Every competitor asking the same question\nends up with the same feature.",
    ],
  },
  "two-column": {
    heading: "'Where can I add AI?' is the wrong question",
    bullets: [
      "It starts from the tool, not the problem.",
      "It treats AI as a feature to bolt on somewhere convenient.",
      "It ends in a chatbot, a summary button, or an AI-powered badge.",
    ],
    bulletsB: [
      "It never touches your pricing, your ops, or your model.",
      "It's easy to answer, which is exactly the problem.",
      "Every competitor asking the same question ends up with the same feature.",
    ],
  },
  "split-right": {
    heading: "The unlock sits underneath the product",
    bullets: [
      "Too expensive: something you would only do for your biggest customer, now doable for everyone.",
      "Too slow: something that took a specialist a week, now possible in minutes.",
    ],
  },
};

const LONG_ORDER: SceneLayout[] = ["bullets", "two-column", "split-right"];

const ORDER: SceneLayout[] = [
  "title",
  "cover",
  "section",
  "statement",
  "bullets",
  "two-column",
  "three-up",
  "quote",
  "chart",
  "code",
  "split-left",
  "split-right",
  "media-full",
  "closing",
  "custom",
];

function Sheet() {
  return (
    <div style={{ padding: 24, background: "#0b0b0d", fontFamily: "system-ui, sans-serif" }}>
      <div style={{ display: "grid", gridTemplateColumns: `repeat(2, ${CELL}px)`, gap: 18 }}>
        {ORDER.map((layout) => (
          <figure key={layout} data-sheet-cell style={{ margin: 0 }}>
            <figcaption
              data-sheet-label
              style={{ color: "#c9c9d4", fontSize: 12, marginBottom: 5 }}
            >
              {layout}
            </figcaption>
            <div style={{ width: CELL, height: Math.round(CELL / (16 / 9)) }}>
              <Stage
                // Settled, because that is what an author is handed: a cover
                // composes an empty veil for generation to fill, and anything
                // that never gets a picture degrades to the title slide
                // beneath it.
                content={settleCover(composeScene(layout, CONTENT[layout] ?? {}))}
                theme={THEME}
                aspect="16:9"
                surface="card"
                fixedScale={CELL / STAGE_BASE_WIDTH}
                className="h-full w-full rounded-[6px]"
              />
            </div>
          </figure>
        ))}
        {LONG_ORDER.map((layout) => (
          <figure key={`long-${layout}`} data-sheet-cell style={{ margin: 0 }}>
            <figcaption
              data-sheet-label
              style={{ color: "#c9c9d4", fontSize: 12, marginBottom: 5 }}
            >
              {layout} (long)
            </figcaption>
            <div style={{ width: CELL, height: Math.round(CELL / (16 / 9)) }}>
              <Stage
                content={settleCover(composeScene(layout, LONG[layout] ?? {}))}
                theme={THEME}
                aspect="16:9"
                surface="card"
                fixedScale={CELL / STAGE_BASE_WIDTH}
                className="h-full w-full rounded-[6px]"
              />
            </div>
          </figure>
        ))}
      </div>
    </div>
  );
}

const host = document.createElement("div");
document.body.appendChild(host);
createRoot(host).render(<Sheet />);
document.body.dataset.ready = "true";
