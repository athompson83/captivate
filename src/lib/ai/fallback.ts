import type { GeneratedScene } from "./schemas";

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

export function keywords(prompt: string, limit = 6): string[] {
  const words = prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    // Anything with a digit in it is a measurement, not a subject. Without
    // this, "a 45-minute lecture on sepsis" has "45-minute" as its top
    // keyword — it ties on frequency with every other word and wins the
    // alphabetical tie-break — and every movement purpose reads
    // "Focus on 45-minute."
    .filter((w) => w.length > 3 && !/\d/.test(w) && !STOPWORDS.has(w));

  const counts = new Map<string, number>();
  for (const w of words) counts.set(w, (counts.get(w) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([w]) => w);
}

/**
 * The subject of a request, where there is one worth naming.
 *
 * A single top keyword is not a subject. In a one-line brief every content
 * word appears once, so the "top" keyword is whatever wins an alphabetical
 * tie-break — which is how "Focus on compensated." ended up in every movement
 * purpose of a lecture about compensated shock.
 *
 * A word the author repeated is different: repetition is the signal that it is
 * what the talk is about. Where nothing repeats, this returns null and the
 * purposes stand on their own, which they read perfectly well doing.
 */
export function subjectOf(prompt: string): string | null {
  const counts = new Map<string, number>();
  for (const word of prompt
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length > 3 && !/\d/.test(w) && !STOPWORDS.has(w))) {
    counts.set(word, (counts.get(word) ?? 0) + 1);
  }

  const best = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0];
  return best && best[1] > 1 ? best[0] : null;
}

function sentenceCase(s: string): string {
  const trimmed = s.trim().replace(/\s+/g, " ");
  if (!trimmed) return "";
  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
}

export function deriveTitle(prompt: string): string {
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
