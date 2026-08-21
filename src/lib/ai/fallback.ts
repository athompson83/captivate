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
  "before",
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
  "cover",
  "covering",
  "include",
  "including",
  "using",
  "use",
  "appear",
  "appears",
  "need",
  "want",
  "please",
  "write",
  "generate",
  "presentation",
  "deck",
  "slides",
  "slide",
  "talk",
  "lecture",
  "session",
  "minute",
  "minutes",
  "hour",
  "hours",
  "students",
  "student",
  "audience",
]);

/** Leading phrases people habitually put in a prompt that are not the subject. */
const LEAD_IN =
  /^(please\s+)?(can you\s+)?(make|create|build|write|generate|draft|prepare|put together|give me|i need|i want|help me (with|write|make))\s+(me\s+)?(a|an|the)?\s*/i;
const FORMAT_PHRASE =
  /\b(\d+[-\s]?(minute|min|hour|hr)s?\s+)?(presentation|deck|slide deck|slides?|talk|lecture|session|workshop|briefing|seminar)\b\s*(about|on|for|covering|that covers|explaining)?\s*/i;

function keywords(prompt: string, limit = 6): string[] {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !STOPWORDS.has(w));

  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}

function sentenceCase(s: string): string {
  const trimmed = s.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

function deriveTitle(prompt: string): string {
  const cleaned = prompt.trim().replace(/\s+/g, " ");
  if (!cleaned) return "New presentation";

  const firstSentence = cleaned.split(/(?<=[.!?])\s/)[0] ?? cleaned;

  let stripped = firstSentence.replace(LEAD_IN, "").trim();
  const withoutFormat = stripped.replace(FORMAT_PHRASE, "").trim();

  if (withoutFormat !== stripped) {
    // The article belonged to the noun phrase just removed — "A 50-minute
    // lecture on X" leaves a dangling "A" — so it goes with it.
    stripped = withoutFormat.replace(/^(a|an|the)\s+/i, "").trim();
  }

  const candidate = stripped || firstSentence;

  // Cut at a natural boundary rather than mid-clause, then drop any trailing
  // punctuation the cut left behind.
  const clause = candidate
    .split(/\s+/)
    .slice(0, 12)
    .join(" ")
    .replace(/[,;:]\s*[^,;:]*$/, "")
    .replace(/[.,;:!?\s]+$/, "");

  return sentenceCase(clause || candidate).slice(0, 120) || "New presentation";
}

/**
 * The narrative skeleton used when no model is available.
 *
 * Real section titles beat keyword soup: "What to look for" is a usable prompt
 * for an author, whereas a title extracted from the prompt's most frequent noun
 * is usually a fragment. The topic is woven into the purpose line instead,
 * where a partial phrase reads naturally.
 */
const BODY_BEATS: { title: string; purpose: string; layout: GeneratedScene["layout"] }[] = [
  {
    title: "Why this matters",
    purpose: "Establish the stakes before any detail.",
    layout: "statement",
  },
  {
    title: "The core idea",
    purpose: "State the central concept in one sentence.",
    layout: "bullets",
  },
  {
    title: "How it works",
    purpose: "Walk through the mechanism step by step.",
    layout: "split-right",
  },
  {
    title: "What to look for",
    purpose: "The signals that tell you it is happening.",
    layout: "bullets",
  },
  {
    title: "A worked example",
    purpose: "Make it concrete with a real situation.",
    layout: "split-left",
  },
  {
    title: "Compare and contrast",
    purpose: "Set this against the thing it is confused with.",
    layout: "two-column",
  },
  {
    title: "Common mistakes",
    purpose: "The three errors people actually make.",
    layout: "three-up",
  },
  { title: "By the numbers", purpose: "The data that supports the argument.", layout: "chart" },
  { title: "In practice", purpose: "What to do differently from tomorrow.", layout: "bullets" },
  { title: "The exception", purpose: "Where the rule breaks down, and why.", layout: "quote" },
];

export function fallbackOutline(prompt: string, sceneTarget: number): PresentationOutline {
  const title = deriveTitle(prompt);
  const topic = keywords(prompt, 1)[0];
  const bodyCount = Math.max(2, Math.min(BODY_BEATS.length, sceneTarget - 3));

  const bodyScenes = BODY_BEATS.slice(0, bodyCount).map((beat) => ({
    title: beat.title,
    purpose: topic ? `${beat.purpose} Focus on ${topic}.` : beat.purpose,
    layout: beat.layout,
  }));

  return {
    title,
    subtitle: "",
    approach:
      "Structural draft generated without a language model: a narrative skeleton with a designed composition for every scene. Replace the placeholder wording with your own.",
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
    headingAccent: "",
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
      return {
        ...base,
        heading: "Takeaways",
        headingAccent: "",
        subheading: "The three things worth remembering.",
      };
    case "statement":
      // The claim turns on its second clause, which carries the accent.
      return {
        ...base,
        heading: `${outlineScene.title} —`,
        headingAccent: "state the single idea here.",
      };
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
