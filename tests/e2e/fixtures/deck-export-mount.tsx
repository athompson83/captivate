import { buildPptx, deckFileName } from "@/lib/export/pptx";
import { planDeck } from "@/lib/export/deck-plan";
import { getTheme } from "@/lib/schema/theme";
import type { Scene } from "@/lib/schema/presentation";
import { SceneElement } from "@/lib/schema/presentation";

/**
 * Builds a real `.pptx` in a real browser, and hands it back as bytes.
 *
 * The plan is unit-tested; what this proves is the half that cannot be:
 * that pptxgenjs, in a browser, with this plan, produces a file whose parts
 * PowerPoint and Keynote will actually find. A zip missing
 * `ppt/presentation.xml` opens as a corrupt file and no amount of testing the
 * plan says so.
 *
 * Bundled and opened from `file://` — no server and no account, like the
 * shader and lifecycle specs beside it.
 */

const PRESENTATION = "00000000-0000-4000-8000-00000000abcd";
const ASIDE = "00000000-0000-4000-8000-00000000dcba";

const element = (over: Record<string, unknown> & { type: string }) =>
  SceneElement.parse({
    id: crypto.randomUUID(),
    frame: { x: 8, y: 10, w: 60, h: 18, rotation: 0 },
    ...over,
  });

function scene(over: {
  id: string;
  title: string;
  elements: ReturnType<typeof element>[];
  flowRole?: "main" | "detail";
  notes?: string;
}): Scene {
  return {
    id: over.id,
    presentationId: PRESENTATION,
    sectionId: null,
    position: 0,
    title: over.title,
    content: {
      layout: "custom",
      background: { kind: "theme" },
      elements: over.elements,
    } as Scene["content"],
    placement: null,
    momentId: null,
    speakerNotes: over.notes ?? "",
    durationSeconds: null,
    flowRole: over.flowRole ?? "main",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
  };
}

const SCENES: Scene[] = [
  scene({
    id: "00000000-0000-4000-8000-000000000001",
    title: "Shock is a clinical diagnosis",
    notes: "Ask the room what they check first.",
    elements: [
      element({
        type: "heading",
        level: 1,
        content: [{ text: "Shock is a clinical diagnosis" }],
        hotspot: { targetSceneId: ASIDE, label: "The numbers" },
      }),
      element({
        type: "list",
        frame: { x: 8, y: 40, w: 45, h: 30, rotation: 0 },
        ordered: false,
        items: [[{ text: "Perfusion, not pressure" }], [{ text: "Look at the skin" }]],
      }),
      element({
        type: "drawing",
        frame: { x: 58, y: 38, w: 34, h: 40, rotation: 0 },
        viewBox: { width: 200, height: 120 },
        paths: [
          { d: "M20 100 C 60 20, 140 20, 180 100", stage: 0 },
          { d: "M20 100 L180 100", stage: 1 },
        ],
        stageLabels: ["The curve", "The floor"],
        ink: "accent",
        alt: "A falling curve",
      }),
    ],
  }),
  scene({
    id: ASIDE,
    title: "The numbers behind it",
    flowRole: "detail",
    elements: [
      element({
        type: "chart",
        frame: { x: 12, y: 15, w: 70, h: 60, rotation: 0 },
        chart: "column",
        title: "Mortality by hour",
        data: [
          { label: "0-1", value: 6 },
          { label: "1-2", value: 14 },
          { label: "2-3", value: 27 },
        ],
      }),
    ],
  }),
];

declare global {
  interface Window {
    exportDeck: () => Promise<{ bytes: number[]; name: string; slides: number }>;
  }
}

window.exportDeck = async () => {
  const plan = planDeck({ title: "Shock", aspectRatio: "16:9" }, SCENES, getTheme("midnight"));
  const blob = await buildPptx(plan, "Shock");
  const bytes = [...new Uint8Array(await blob.arrayBuffer())];
  return { bytes, name: deckFileName("Shock"), slides: plan.slides.length };
};

document.body.dataset.ready = "true";
