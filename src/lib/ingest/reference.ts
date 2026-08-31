/**
 * Turning a file somebody already has into material a generation can be
 * grounded in.
 *
 * An author writing a lecture usually has the lecture already — last year's
 * deck, the paper it is built on, a set of notes. Making them retype it into
 * a prompt box is the whole reason "AI presentation tools" feel like a party
 * trick: the model invents a talk about the topic rather than writing *their*
 * talk.
 *
 * This module is the extraction, and it is pure: bytes and strings in, text
 * out. It has no DOM and no network, so every rule about what survives, what
 * is dropped and how much is sent is testable. `read-file.ts` does the
 * browser half — unzipping and decoding — and decides nothing.
 *
 * **The extraction runs in the browser**, like the deck export and for the
 * same reason: the file is already there, and parsing untrusted documents on
 * a server is an attack surface that does not need to exist. Nothing is
 * uploaded, nothing is stored, and what reaches the model is bounded text.
 */

/**
 * How much reference text a generation may carry.
 *
 * Roughly fifteen thousand tokens, which leaves room for the system prompt,
 * the author's own brief and a full answer inside the model's window. A whole
 * textbook chapter fits; a whole textbook does not, and saying so is better
 * than silently sending the first tenth of one.
 */
export const REFERENCE_LIMIT = 60_000;

/** What a reader produced, and what the author should be told about it. */
export interface Reference {
  /** The file it came from, for the prompt and for the author to recognise. */
  name: string;
  text: string;
  /** Characters dropped by the limit. Zero when the whole file fitted. */
  truncated: number;
}

export type ReferenceFormat = "text" | "markdown" | "pptx" | "docx" | "pdf" | "unsupported";

/**
 * What a file is, by extension rather than by its declared MIME type.
 *
 * Browsers disagree about the MIME type of a `.pptx` — some report the OOXML
 * type, some `application/zip`, some nothing at all, and a file dragged from
 * a network share often arrives with an empty type. The extension is what the
 * author sees and is the more reliable of two unreliable signals; the reader
 * then verifies by looking at the bytes.
 */
export function formatOf(filename: string): ReferenceFormat {
  const extension = filename.toLowerCase().split(".").pop() ?? "";
  if (extension === "md" || extension === "markdown") return "markdown";
  if (["txt", "csv", "tsv", "rtf", "vtt", "srt", "json"].includes(extension)) return "text";
  if (extension === "pptx") return "pptx";
  if (extension === "docx") return "docx";
  if (extension === "pdf") return "pdf";
  return "unsupported";
}

/** Formats a reader exists for, phrased for a file input's `accept`. */
export const ACCEPTED_REFERENCE_TYPES = ".txt,.md,.markdown,.csv,.tsv,.vtt,.srt,.pptx,.docx";

/**
 * What to say when a file cannot be read.
 *
 * Named formats rather than "unsupported file", because the author is holding
 * a file and needs to know whether to convert it or give up.
 */
export function refusalFor(filename: string): string | null {
  const format = formatOf(filename);
  if (format === "pdf") {
    return "PDFs aren't read yet. Export it to Word, or paste the text into your brief.";
  }
  if (format === "unsupported") {
    return "That file type can't be read. Try a .pptx, .docx, .md or .txt — or paste the text into your brief.";
  }
  return null;
}

/**
 * Every run of text in an OOXML part, in document order.
 *
 * PowerPoint and Word both store their words in `<a:t>` and `<w:t>` elements
 * respectively, and both are XML inside a zip. Reading them with a regex
 * rather than an XML parser is deliberate: the only thing wanted is the text
 * between two known tags, and a parser for a document format is a far larger
 * thing to point at a file somebody was handed.
 */
export function textFromOoxmlPart(xml: string, tag: "a:t" | "w:t"): string[] {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g");
  return [...xml.matchAll(pattern)].map((match) => decodeXmlEntities(match[1]));
}

function decodeXmlEntities(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replaceAll("&amp;", "&");
}

/** Slide parts, in the order PowerPoint numbers them rather than zip order. */
export function orderSlideParts(paths: readonly string[]): string[] {
  const number = (path: string) => Number(/slide(\d+)\.xml$/.exec(path)?.[1] ?? 0);
  return paths
    .filter((path) => /^ppt\/slides\/slide\d+\.xml$/.test(path))
    .sort((a, b) => number(a) - number(b));
}

/**
 * The words of a deck, kept as slides.
 *
 * The slide boundaries are the argument's own structure — losing them turns a
 * talk into a bag of phrases, and a model asked to re-shape a bag of phrases
 * has to guess at an order the author already chose.
 */
export function deckToText(slides: readonly string[][]): string {
  return slides
    .map((runs, index) => {
      const body = runs
        .map((run) => run.trim())
        .filter(Boolean)
        .join("\n");
      return body ? `--- Slide ${index + 1} ---\n${body}` : "";
    })
    .filter(Boolean)
    .join("\n\n");
}

/** The words of a document, with its paragraph breaks kept. */
export function documentToText(runs: readonly string[]): string {
  return runs
    .map((run) => run.trim())
    .filter(Boolean)
    .join("\n");
}

/**
 * Whitespace normalised, and the length bounded.
 *
 * Bounded at the *end* of a paragraph rather than mid-sentence: a reference
 * that stops in the middle of a clause reads to a model as a claim the author
 * made and did not finish.
 */
export function normaliseReference(name: string, raw: string): Reference {
  const cleaned = raw
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n")
    .replaceAll(/[ \t]+/g, " ")
    .replaceAll(/\n{3,}/g, "\n\n")
    .trim();

  if (cleaned.length <= REFERENCE_LIMIT) {
    return { name, text: cleaned, truncated: 0 };
  }

  const window = cleaned.slice(0, REFERENCE_LIMIT);
  const breakAt = Math.max(window.lastIndexOf("\n\n"), window.lastIndexOf("\n"));
  const kept = breakAt > REFERENCE_LIMIT * 0.6 ? window.slice(0, breakAt) : window;
  return { name, text: kept.trim(), truncated: cleaned.length - kept.length };
}

/**
 * The reference as it appears in a prompt.
 *
 * Fenced and labelled, so the model can tell the author's material from the
 * author's instructions — and told, in the same breath, that this is source
 * rather than a script to reproduce. Without that a generation returns the
 * reference back, reformatted, which is not a talk.
 */
export function referenceBlock(reference: Reference | null): string {
  if (!reference || !reference.text) return "";
  const truncationNote =
    reference.truncated > 0
      ? `\n(This is the first part of the file; ${reference.truncated.toLocaleString()} characters were not included.)`
      : "";

  return `The author has provided reference material from "${reference.name}". Ground the argument in it: use its facts, its examples, its terminology and its emphasis. Do not repeat it back — the author already has this file, and wants a talk built from it. Never state anything as fact that is not in this material or in their request.${truncationNote}

<reference>
${reference.text}
</reference>`;
}

/** One line telling the author what was read, before anything is generated. */
export function describeReference(reference: Reference): string {
  const words = reference.text.split(/\s+/).filter(Boolean).length;
  const shortened = reference.truncated > 0 ? ` The rest of the file was too long to include.` : "";
  return `Read ${words.toLocaleString()} words from ${reference.name}.${shortened}`;
}
