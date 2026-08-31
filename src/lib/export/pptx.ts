import PptxGenJS from "pptxgenjs";
import type { DeckPlan, PlannedRun, PlannedShape, PlannedSlide } from "./deck-plan";

/**
 * The plan, written as a `.pptx` file.
 *
 * Makes no decisions — `deck-plan.ts` made them all, and they are tested
 * there. This module knows PowerPoint's vocabulary and nothing about
 * Captivate's.
 *
 * **It runs in the browser, deliberately.** pptxgenjs reaches for Node's
 * `image-size` when it runs on a server, and that package carries two
 * unfixed denial-of-service advisories in its image parsers. Its `browser`
 * field maps `image-size` to `false`, so building the file on the client
 * keeps that code out of the bundle entirely rather than trusting that we
 * never hand it a hostile picture. It is also simply the right place: the
 * deck is already loaded, the asset URLs are already signed for this user,
 * and no serverless duration limit applies to a file that may be sixty
 * megabytes of photographs.
 *
 * Keynote opens `.pptx` directly, which is why there is one format here and
 * not two. A `.key` file is an undocumented package format with no writer
 * worth trusting; claiming to export it would be claiming more than is true.
 */

/** Keynote and PowerPoint both take this; nothing else is written. */
export const DECK_MIME =
  "application/vnd.openxmlformats-officedocument.presentationml.presentation";

function hex(color: string): string {
  return color.replace("#", "").toUpperCase();
}

function runsFor(runs: PlannedRun[], fallback: string): PptxGenJS.TextProps[] {
  return runs.map((run) => ({
    text: run.text,
    options: {
      bold: run.bold,
      italic: run.italic,
      underline: run.underline ? { style: "sng" as const } : undefined,
      color: hex(run.color ?? fallback),
      hyperlink: run.href ? { url: run.href } : undefined,
    },
  }));
}

/**
 * An SVG drawing as a PNG data URI.
 *
 * PowerPoint's SVG support is version-dependent and silently absent in
 * Keynote, so a picture that renders everywhere is worth more than one that
 * stays vector. Drawn at three times its own size because a slide is often
 * projected, and a line that was crisp on the canvas should not be the one
 * soft thing in the room.
 */
async function rasterise(svg: string, widthInches: number): Promise<string | null> {
  const pixels = Math.min(2400, Math.max(600, Math.round(widthInches * 96 * 3)));
  const source = `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;

  const image = new Image();
  image.crossOrigin = "anonymous";
  const loaded = new Promise<boolean>((resolve) => {
    image.onload = () => resolve(true);
    image.onerror = () => resolve(false);
  });
  image.src = source;
  if (!(await loaded)) return null;

  const ratio = image.naturalHeight / image.naturalWidth || 1;
  const canvas = document.createElement("canvas");
  canvas.width = pixels;
  canvas.height = Math.round(pixels * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/png");
}

function addShape(slide: PptxGenJS.Slide, pptx: PptxGenJS, shape: PlannedShape): void {
  const box = shape.box;
  const common = {
    x: box.x,
    y: box.y,
    w: Math.max(0.05, box.w),
    h: Math.max(0.02, box.h),
    rotate: box.rotation || undefined,
    transparency: shape.opacity < 1 ? Math.round((1 - shape.opacity) * 100) : undefined,
  };

  switch (shape.kind) {
    case "text": {
      slide.addText(runsFor(shape.runs, shape.color), {
        ...common,
        fontSize: shape.fontSize,
        fontFace: shape.monospace ? "Consolas" : undefined,
        color: hex(shape.color),
        bold: shape.bold,
        italic: shape.italic,
        align: shape.align,
        valign: shape.valign,
        // Off, because the plan already placed this box where the stage put
        // it. Letting PowerPoint grow the box would move text the author
        // positioned deliberately.
        autoFit: false,
        wrap: true,
        hyperlink: shape.linkToSlide ? { slide: shape.linkToSlide } : undefined,
      });
      break;
    }
    case "bullets": {
      const items = shape.items.map((item, index) => ({
        text: item.map((run) => run.text).join(""),
        options: {
          bullet: shape.ordered ? { type: "number" as const } : true,
          breakLine: index < shape.items.length - 1,
        },
      }));
      slide.addText(items, {
        ...common,
        fontSize: shape.fontSize,
        color: hex(shape.color),
        valign: "top",
        autoFit: false,
        hyperlink: shape.linkToSlide ? { slide: shape.linkToSlide } : undefined,
      });
      break;
    }
    case "image": {
      slide.addImage({
        ...common,
        path: shape.url,
        altText: shape.alt || undefined,
        sizing: { type: shape.fit === "cover" ? "cover" : "contain", w: common.w, h: common.h },
        hyperlink: shape.linkToSlide ? { slide: shape.linkToSlide } : undefined,
      });
      break;
    }
    case "shape": {
      const type =
        shape.shape === "ellipse"
          ? pptx.ShapeType.ellipse
          : shape.shape === "triangle"
            ? pptx.ShapeType.triangle
            : shape.shape === "line"
              ? pptx.ShapeType.line
              : pptx.ShapeType.roundRect;
      slide.addShape(type, {
        ...common,
        fill: shape.fill ? { color: hex(shape.fill) } : { type: "none" },
        line: shape.stroke
          ? { color: hex(shape.stroke), width: shape.strokeWidth || 1 }
          : undefined,
        rectRadius: shape.radius || undefined,
        hyperlink: shape.linkToSlide ? { slide: shape.linkToSlide } : undefined,
      });
      break;
    }
    case "chart": {
      // A native chart, not a picture of one: it stays editable in the file,
      // which is most of the reason somebody asked for PowerPoint.
      const type =
        shape.chart === "line"
          ? pptx.ChartType.line
          : shape.chart === "donut"
            ? pptx.ChartType.doughnut
            : shape.chart === "bar"
              ? pptx.ChartType.bar
              : pptx.ChartType.bar;
      slide.addChart(
        type,
        [
          {
            name: shape.title || "Series 1",
            labels: shape.points.map((point) => point.label),
            values: shape.points.map((point) => point.value),
          },
        ],
        {
          ...common,
          barDir: shape.chart === "bar" ? "bar" : "col",
          chartColors: [hex(shape.color)],
          showTitle: Boolean(shape.title),
          title: shape.title || undefined,
          showLegend: false,
        },
      );
      break;
    }
    case "drawing":
      // Handled by the caller, which can await the raster.
      break;
  }
}

async function addSlide(pptx: PptxGenJS, planned: PlannedSlide): Promise<void> {
  const slide = pptx.addSlide();
  slide.background = planned.background.image
    ? { path: planned.background.image }
    : { color: hex(planned.background.color) };

  for (const shape of planned.shapes) {
    if (shape.kind === "drawing") {
      const png = await rasterise(shape.svg, shape.box.w);
      if (png) {
        slide.addImage({
          x: shape.box.x,
          y: shape.box.y,
          w: Math.max(0.05, shape.box.w),
          h: Math.max(0.05, shape.box.h),
          data: png,
          altText: shape.alt || undefined,
          sizing: { type: "contain", w: shape.box.w, h: shape.box.h },
        });
      }
      continue;
    }
    addShape(slide, pptx, shape);
  }

  if (planned.notes) slide.addNotes(planned.notes);
}

/** The finished file, ready to hand to the browser. */
export async function buildPptx(plan: DeckPlan, title: string): Promise<Blob> {
  const pptx = new PptxGenJS();
  pptx.title = title;
  pptx.layout = plan.aspect === "4:3" ? "LAYOUT_4x3" : "LAYOUT_16x9";

  for (const planned of plan.slides) {
    await addSlide(pptx, planned);
  }

  const output = await pptx.write({ outputType: "blob" });
  return output as Blob;
}

/** A file name that survives being emailed around. */
export function deckFileName(title: string): string {
  const safe = title
    .trim()
    .replace(/[^\p{L}\p{N} _-]/gu, "")
    .replace(/\s+/g, " ")
    .slice(0, 80)
    .trim();
  return `${safe || "presentation"}.pptx`;
}
