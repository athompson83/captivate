import type { GeneratedScene, PresentationOutline } from "./schemas";

/**
 * Deterministic generator used when no model is configured.
 *
 * This exists so the create-with-AI path is never a dead end on a deployment
 * without an API key: the user still gets a real, editable, well-composed deck
 * skeleton. It is explicitly labelled as a structural draft in the UI — it is
 * not presented as AI-written content, because it isn't.
 */

const STOPWORDS = new Set([
  "a",
  "an",
  "the",
  "and",
  "or",
  "but",
  "for",
  "of",
  "to",
  "in",
  "on",
  "at",
  "by",
  "with",
  "about",
  "from",
  "into",
  "over",
  "after",
  "is",
  "are",
  "was",
  "were",
  "be",
  "been",
  "being",
  "how",
  "what",
  "why",
  "when",
  "where",
  "which",
  "that",
  "this",
  "these",
  "those",
  "my",
  "your",
  "our",
  "their",
  "its",
  "it",
  "as",
  "i",
  "we",
  "you",
  "they",
  "he",
  "she",
  "them",
  "us",
  "me",
  "do",
  "does",
  "did",
  "can",
  "could",
  "should",
  "would",
  "will",
  "make",
  "create",
  "build",
  "give",
  "presentation",
  "deck",
  "slides",
  "slide",
  "talk",
  "lecture",
  "session",
]);

function keywords(prompt: string, limit = 6): string[] {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w));

  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function deriveTitle(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  const firstSentence = cleaned.split(/[.!?\n]/)[0] ?? cleaned;
  const stripped = firstSentence
    .replace(
      /^(please\s+)?(make|create|build|write|generate|give me|i need|i want)\s+(me\s+)?(a|an|the)?\s*/i,
      "",
    )
    .replace(
      /\b(presentation|deck|slides?|talk|lecture|session)\b\s*(about|on|for|covering)?\s*/i,
      "",
    )
    .trim();

  const candidate = stripped || cleaned;
  const words = candidate.split(/\s+/).slice(0, 10).join(" ");
  return titleCase(words).slice(0, 120) || "New presentation";
}

export function fallbackOutline(prompt: string, sceneTarget: number): PresentationOutline {
  const title = deriveTitle(prompt);
  const topics = keywords(prompt);
  const bodyCount = Math.max(2, Math.min(10, sceneTarget - 3));

  const bodyScenes = Array.from({ length: bodyCount }, (_, i) => {
    const topic = topics[i % Math.max(1, topics.length)] ?? `Point ${i + 1}`;
    // Rotate layouts so the skeleton is not a wall of identical bullet slides.
    const layouts = [
      "bullets",
      "split-right",
      "statement",
      "three-up",
      "split-left",
      "two-column",
    ] as const;
    return {
      title: titleCase(topic),
      purpose: `Develop ${topic} and show why it matters to the audience.`,
      layout: layouts[i % layouts.length],
    };
  });

  return {
    title,
    subtitle: "",
    approach:
      "Structural draft generated without a language model. Every scene is a real, editable composition — replace the placeholder wording with your own.",
    sections: [
      {
        title: "Opening",
        scenes: [
          { title: "Title", purpose: "Set the topic and who it is for.", layout: "title" as const },
          {
            title: "What we'll cover",
            purpose: "Give the audience the shape of the session.",
            layout: "bullets" as const,
          },
        ],
      },
      { title: "Main content", scenes: bodyScenes },
      {
        title: "Close",
        scenes: [
          {
            title: "Takeaways",
            purpose: "Leave them with the points that matter.",
            layout: "closing" as const,
          },
        ],
      },
    ],
    suggestedThemeId: "midnight",
  };
}

export function fallbackScene(
  outlineScene: { title: string; purpose: string; layout: GeneratedScene["layout"] },
  context: { title: string; prompt: string },
): GeneratedScene {
  const base: GeneratedScene = {
    title: outlineScene.title,
    layout: outlineScene.layout,
    heading: outlineScene.title,
    subheading: "",
    eyebrow: "",
    body: "",
    bullets: [],
    bulletsB: [],
    quote: "",
    attribution: "",
    caption: "",
    cards: [],
    chart: null,
    code: null,
    imagePrompt: "",
    speakerNotes: `${outlineScene.purpose} Replace this placeholder with what you'll actually say.`,
  };

  switch (outlineScene.layout) {
    case "title":
      return {
        ...base,
        heading: context.title,
        subheading: "Add your name, the date, or the course here.",
      };
    case "closing":
      return { ...base, heading: "Takeaways", subheading: "The three things worth remembering." };
    case "statement":
      return { ...base, heading: `${outlineScene.title} — state the single idea here.` };
    case "quote":
      return { ...base, quote: "A line worth repeating.", attribution: "Source" };
    case "three-up":
      return {
        ...base,
        cards: [
          { title: "First", body: "What it is and why it matters." },
          { title: "Second", body: "What it is and why it matters." },
          { title: "Third", body: "What it is and why it matters." },
        ],
      };
    case "two-column":
      return {
        ...base,
        bullets: ["First consideration", "Second consideration"],
        bulletsB: ["First contrast", "Second contrast"],
      };
    case "split-left":
    case "split-right":
      return {
        ...base,
        bullets: ["Key point", "Supporting point", "What it means in practice"],
        imagePrompt: `An illustrative image for ${outlineScene.title}`,
      };
    case "media-full":
      return {
        ...base,
        caption: "Add a caption.",
        imagePrompt: `A striking image for ${outlineScene.title}`,
      };
    case "chart":
      return {
        ...base,
        chart: {
          chart: "column",
          data: [
            { label: "A", value: 30 },
            { label: "B", value: 55 },
            { label: "C", value: 40 },
          ],
          summary: "Replace with your own figures.",
        },
        caption: "Source and period.",
      };
    case "code":
      return { ...base, code: { code: "// Replace with your example", language: "text" } };
    case "section":
      return { ...base, eyebrow: "Section", heading: outlineScene.title };
    default:
      return { ...base, bullets: ["First point", "Second point", "Third point"] };
  }
}

/** Rule-based rewrite so text tools degrade rather than disappear. */
export function fallbackRewrite(text: string, mode: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [trimmed];

  switch (mode) {
    case "shorten": {
      const first = trimmed.split(/(?<=[.!?])\s+/)[0] ?? trimmed;
      return [
        first.length < trimmed.length
          ? first
          : trimmed
              .split(/\s+/)
              .slice(0, Math.ceil(trimmed.split(/\s+/).length / 2))
              .join(" "),
      ];
    }
    case "simplify":
      return [
        trimmed
          .replace(/\b(utilise|utilize)\b/gi, "use")
          .replace(/\b(commence)\b/gi, "start")
          .replace(/\b(demonstrate)\b/gi, "show")
          .replace(/\b(approximately)\b/gi, "about"),
      ];
    default:
      return [trimmed];
  }
}
