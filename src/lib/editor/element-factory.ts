import { richText, type SceneElement, type SceneElementType } from "@/lib/schema/presentation";
import { elementId } from "./layouts";

/**
 * Sensible defaults for every insertable element.
 *
 * New elements land in the middle of the stage at a size that suits their type,
 * already styled by the theme — never as an unstyled empty box that the user
 * has to configure before it looks like anything.
 */
export function createElement(type: SceneElementType, at?: { x: number; y: number }): SceneElement {
  const base = {
    id: elementId(type),
    hidden: false,
    locked: false,
    opacity: 1,
    // A new element is not a control until an author makes it one.
    hotspot: null,
    animation: {
      entrance: "fade" as const,
      delay: 0,
      duration: 0.5,
      emphasis: "none" as const,
      onAdvance: false,
      exit: "none" as const,
    },
  };

  const style = {
    size: 1,
    weight: 400 as const,
    align: "left" as const,
    valign: "top" as const,
    italic: false,
    underline: false,
    uppercase: false,
    lineHeight: 1.4,
    letterSpacing: 0,
    family: "sans" as const,
  };

  const centred = (w: number, h: number) => ({
    x: at ? Math.max(2, at.x - w / 2) : (100 - w) / 2,
    y: at ? Math.max(2, at.y - h / 2) : (100 - h) / 2,
    w,
    h,
    rotation: 0,
  });

  switch (type) {
    case "heading":
      return {
        ...base,
        type: "heading",
        level: 2,
        frame: centred(60, 14),
        content: richText("Heading"),
        style: {
          ...style,
          size: 0.72,
          weight: 600,
          lineHeight: 1.1,
          letterSpacing: -0.02,
          family: "display",
        },
      };

    case "text":
      return {
        ...base,
        type: "text",
        frame: centred(52, 16),
        content: richText("Body text"),
        style: { ...style, size: 0.55, lineHeight: 1.5 },
      };

    case "quote":
      return {
        ...base,
        type: "quote",
        frame: centred(64, 24),
        content: richText("A line worth repeating."),
        attribution: "",
        style: {
          ...style,
          size: 1.1,
          align: "center",
          valign: "middle",
          lineHeight: 1.25,
          family: "display",
        },
      };

    case "list":
      return {
        ...base,
        type: "list",
        frame: centred(56, 30),
        ordered: false,
        items: [richText("First point"), richText("Second point"), richText("Third point")],
        staggered: true,
        style: { ...style, size: 0.55, lineHeight: 1.5 },
      };

    case "image":
      return {
        ...base,
        type: "image",
        frame: centred(46, 46),
        assetId: null,
        url: "",
        alt: "",
        fit: "cover",
        focalX: 0.5,
        focalY: 0.5,
        radius: 1.5,
        scrim: 0,
      };

    case "video":
      return {
        ...base,
        type: "video",
        frame: centred(56, 34),
        assetId: null,
        url: "",
        poster: "",
        autoplay: false,
        loop: false,
        muted: true,
        controls: true,
        radius: 1.5,
        alt: "",
      };

    case "audio":
      return {
        ...base,
        type: "audio",
        frame: centred(46, 12),
        assetId: null,
        url: "",
        title: "Audio",
        autoplay: false,
      };

    case "shape":
      return {
        ...base,
        type: "shape",
        frame: centred(28, 22),
        shape: "rectangle",
        fill: { kind: "token", token: "accent" },
        stroke: null,
        strokeWidth: 0,
        radius: 1.5,
      };

    case "divider":
      return { ...base, type: "divider", frame: centred(50, 4), thickness: 0.25, color: null };

    case "icon":
      return {
        ...base,
        type: "icon",
        frame: centred(12, 12),
        name: "star",
        color: { kind: "token", token: "accent" },
        strokeWidth: 1.75,
      };

    case "callout":
      return {
        ...base,
        type: "callout",
        frame: centred(38, 28),
        tone: "accent",
        icon: "lightbulb",
        title: "Key point",
        content: richText("Why this matters."),
        style: { ...style, size: 0.44, lineHeight: 1.5 },
      };

    case "code":
      return {
        ...base,
        type: "code",
        frame: centred(60, 34),
        code: "function example() {\n  return true;\n}",
        language: "javascript",
        showLineNumbers: false,
        style: { ...style, size: 0.42, lineHeight: 1.6, family: "mono" },
      };

    case "chart":
      return {
        ...base,
        type: "chart",
        frame: centred(60, 42),
        chart: "column",
        title: "",
        data: [
          { label: "One", value: 32 },
          { label: "Two", value: 58 },
          { label: "Three", value: 41 },
        ],
        showValues: true,
        palette: "accent",
        summary: "Three values: One 32, Two 58, Three 41.",
      };

    case "embed":
      return {
        ...base,
        type: "embed",
        frame: centred(60, 38),
        url: "https://example.com",
        provider: "generic",
        title: "Embedded content",
        radius: 1.5,
      };

    case "drawing":
      // A real three-stage sample rather than an empty box: the element shows
      // what it is the moment it lands, and Generate replaces it wholesale.
      return {
        ...base,
        type: "drawing",
        frame: centred(48, 34),
        viewBox: { width: 240, height: 140 },
        paths: [
          { d: "M 30 70 A 22 22 0 1 0 74 70 A 22 22 0 1 0 30 70", stage: 0 },
          { d: "M 84 70 L 148 70", stage: 1 },
          { d: "M 138 62 L 150 70 L 138 78", stage: 1 },
          { d: "M 158 48 L 218 48 L 218 92 L 158 92 Z", stage: 2 },
        ],
        stageLabels: ["The starting point", "What it leads to", "Where it lands"],
        ink: "ink",
        strokeWidth: 2,
        paceSeconds: 1.6,
        prompt: "",
        alt: "A sample diagram: a circle leading to a box",
      };

    default: {
      const exhaustive: never = type;
      throw new Error(`Unhandled element type: ${String(exhaustive)}`);
    }
  }
}

export const INSERTABLE: { type: SceneElementType; label: string; group: string }[] = [
  { type: "heading", label: "Heading", group: "Text" },
  { type: "text", label: "Text", group: "Text" },
  { type: "list", label: "List", group: "Text" },
  { type: "quote", label: "Quote", group: "Text" },
  { type: "callout", label: "Callout", group: "Text" },
  { type: "code", label: "Code", group: "Text" },
  { type: "image", label: "Image", group: "Media" },
  { type: "drawing", label: "Drawing", group: "Media" },
  { type: "video", label: "Video", group: "Media" },
  { type: "audio", label: "Audio", group: "Media" },
  { type: "embed", label: "Embed", group: "Media" },
  { type: "chart", label: "Chart", group: "Objects" },
  { type: "shape", label: "Shape", group: "Objects" },
  { type: "icon", label: "Icon", group: "Objects" },
  { type: "divider", label: "Divider", group: "Objects" },
];
