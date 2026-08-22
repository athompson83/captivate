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
  momentBrief: {
    title: string;
    purpose: string;
    layout: GeneratedScene["layout"];
    /** What the audience must leave with — the beat's own words, when the map has them. */
    takeaway?: string;
    instructions?: string;
    evidence?: { label: string }[];
    movementTitle?: string;
  },
  context: { title: string; prompt: string },
): GeneratedScene {
  const takeaway = (momentBrief.takeaway ?? "").trim();
  const purpose = momentBrief.purpose.trim();
  const evidence = (momentBrief.evidence ?? []).map((item) => item.label).filter(Boolean);

  // The author already wrote the argument — purpose, takeaway, evidence are
  // theirs, from the map. A fallback that ignores them and prints "Key point"
  // wastes the most valuable text in the document. So the takeaway leads, the
  // purpose becomes prose, and the evidence becomes the support — real
  // content, honestly derived, still labelled as written without a model.
  const speakerNotes = [
    purpose && `This moment exists to ${lowerFirst(purpose)}`,
    takeaway && `Land it so the room leaves knowing: ${takeaway}`,
    evidence.length > 0 && `Ground it in ${listSentence(evidence)}.`,
    momentBrief.instructions,
  ]
    .filter(Boolean)
    .map((line) => ensureSentence(String(line)))
    .join(" ");

  const base: GeneratedScene = {
    title: momentBrief.title,
    layout: momentBrief.layout,
    heading: momentBrief.title,
    headingAccent: "",
    subheading: takeaway.length <= 220 ? takeaway : "",
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
    speakerNotes:
      speakerNotes || `${purpose} Replace this placeholder with what you'll actually say.`,
  };

  switch (momentBrief.layout) {
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
    case "statement": {
      // The claim turns on its second clause, which carries the accent. The
      // takeaway *is* the claim when the map has one.
      if (takeaway && takeaway.length <= 60) {
        return { ...base, heading: `${momentBrief.title} —`, headingAccent: takeaway, subheading: "" };
      }
      return {
        ...base,
        heading: takeaway && takeaway.length <= 120 ? takeaway : `${momentBrief.title} —`,
        headingAccent: takeaway && takeaway.length <= 120 ? "" : "state the single idea here.",
        subheading: "",
      };
    }
    case "quote":
      return takeaway
        ? { ...base, quote: clip(takeaway, 300), attribution: momentBrief.movementTitle ?? "", subheading: "" }
        : { ...base, quote: "A line worth repeating.", attribution: "Source" };
    case "three-up": {
      const cards = [
        purpose && { title: "Why it matters", body: clip(purpose, 180) },
        takeaway && { title: "What to remember", body: clip(takeaway, 180) },
        evidence[0] && { title: "The evidence", body: clip(evidence.join(" · "), 180) },
      ].filter(Boolean) as { title: string; body: string }[];
      return cards.length >= 2
        ? { ...base, cards: cards.slice(0, 3), subheading: "" }
        : {
            ...base,
            cards: [
              { title: "First", body: "What it is and why it matters." },
              { title: "Second", body: "What it is and why it matters." },
              { title: "Third", body: "What it is and why it matters." },
            ],
          };
    }
    case "two-column":
      return {
        ...base,
        bullets: bulletsFrom([purpose], ["First consideration", "Second consideration"]),
        bulletsB: bulletsFrom(
          [takeaway, ...evidence],
          ["First contrast", "Second contrast"],
        ),
        subheading: "",
      };
    case "split-left":
    case "split-right":
      return {
        ...base,
        bullets: bulletsFrom(
          [takeaway, purpose, ...evidence.map((label) => `Evidence: ${label}`)],
          ["Key point", "Supporting point", "What it means in practice"],
        ),
        subheading: "",
        imagePrompt: `An illustrative image for ${momentBrief.title}`,
      };
    case "media-full":
      return {
        ...base,
        caption: takeaway ? clip(takeaway, 160) : "Add a caption.",
        subheading: "",
        imagePrompt: `A striking image for ${momentBrief.title}`,
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
      return { ...base, eyebrow: "Section", heading: momentBrief.title };
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

/* Small text helpers for composing honest fallback copy. */

function lowerFirst(text: string): string {
  return text ? text[0].toLowerCase() + text.slice(1) : text;
}

function ensureSentence(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`;
}

function listSentence(items: string[]): string {
  if (items.length <= 1) return items[0] ?? "";
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1).trimEnd()}…`;
}

/** Real material first, clipped to bullet length; placeholders only when empty. */
function bulletsFrom(candidates: (string | undefined)[], placeholder: string[]): string[] {
  const real = candidates
    .map((item) => (item ?? "").trim())
    .filter(Boolean)
    .map((item) => clip(item, 140));
  return real.length > 0 ? real.slice(0, 6) : placeholder;
}
