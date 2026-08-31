import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  ACCEPTED_REFERENCE_TYPES,
  REFERENCE_LIMIT,
  deckToText,
  describeReference,
  documentToText,
  formatOf,
  normaliseReference,
  orderSlideParts,
  referenceBlock,
  refusalFor,
  textFromOoxmlPart,
} from "@/lib/ingest/reference";

/**
 * Reading a file the author already has.
 *
 * The point of the feature is that the model writes *their* talk rather than a
 * talk about their topic, so the tests are about fidelity: the deck's own
 * structure survives, the text is not silently mangled, the bound is honest,
 * and the prompt tells the model this is source rather than a script.
 */

describe("recognising a file", () => {
  it("goes by extension, because browsers disagree about the type", () => {
    // A .pptx arrives as the OOXML type, as application/zip, or as nothing at
    // all depending on the browser and where the file came from.
    expect(formatOf("Lecture 4.pptx")).toBe("pptx");
    expect(formatOf("PAPER.DOCX")).toBe("docx");
    expect(formatOf("notes.md")).toBe("markdown");
    expect(formatOf("transcript.vtt")).toBe("text");
    expect(formatOf("scan.pdf")).toBe("pdf");
    expect(formatOf("archive.zip")).toBe("unsupported");
    expect(formatOf("noextension")).toBe("unsupported");
  });

  it("says what to do instead, rather than 'unsupported file'", () => {
    // The author is holding a file and needs to know whether to convert it.
    expect(refusalFor("paper.pdf")).toMatch(/Word|paste/i);
    expect(refusalFor("thing.key")).toMatch(/pptx|paste/i);
    expect(refusalFor("deck.pptx")).toBeNull();
    expect(refusalFor("notes.txt")).toBeNull();
  });

  it("offers exactly the formats it can actually read", () => {
    for (const extension of ACCEPTED_REFERENCE_TYPES.split(",")) {
      expect(formatOf(`file${extension}`), extension).not.toBe("unsupported");
      expect(refusalFor(`file${extension}`), extension).toBeNull();
    }
  });
});

describe("pulling text out of OOXML", () => {
  it("reads PowerPoint's runs and Word's, and decodes their entities", () => {
    const slide = `<a:p><a:r><a:t>Shock &amp; perfusion</a:t></a:r><a:r><a:t xml:space="preserve">is a diagnosis</a:t></a:r></a:p>`;
    expect(textFromOoxmlPart(slide, "a:t")).toEqual(["Shock & perfusion", "is a diagnosis"]);

    const doc = `<w:p><w:r><w:t>Line &#8212; one</w:t></w:r></w:p>`;
    expect(textFromOoxmlPart(doc, "w:t")).toEqual(["Line — one"]);
  });

  it("decodes &amp; last, so &amp;lt; does not become a tag", () => {
    // Decoding &amp; first turns the escaped text "&amp;lt;" into "<", which
    // is how extracted text grows markup that was never in the document.
    expect(textFromOoxmlPart("<w:t>&amp;lt;script&amp;gt;</w:t>", "w:t")).toEqual([
      "&lt;script&gt;",
    ]);
  });

  it("ignores a tag that merely starts the same way", () => {
    expect(textFromOoxmlPart("<a:tbl><a:t>real</a:t></a:tbl>", "a:t")).toEqual(["real"]);
  });

  it("returns nothing for a part with no runs, rather than throwing", () => {
    expect(textFromOoxmlPart("<p:sld/>", "a:t")).toEqual([]);
  });

  it("orders slides the way PowerPoint numbers them, not the way a zip lists them", () => {
    // A zip's entry order is arbitrary, and slide10 sorts before slide2 as a
    // string — which silently reorders the author's argument.
    const paths = [
      "ppt/slides/slide10.xml",
      "ppt/slides/_rels/slide1.xml.rels",
      "ppt/slides/slide2.xml",
      "ppt/slides/slide1.xml",
      "ppt/media/image1.png",
    ];
    expect(orderSlideParts(paths)).toEqual([
      "ppt/slides/slide1.xml",
      "ppt/slides/slide2.xml",
      "ppt/slides/slide10.xml",
    ]);
  });
});

describe("keeping the shape of what was read", () => {
  it("keeps slide boundaries, because they are the argument's own structure", () => {
    // Flattened, a talk becomes a bag of phrases, and a model asked to shape a
    // bag of phrases has to guess at an order the author already chose.
    const text = deckToText([["Title", "Subtitle"], [], ["A claim", "Its evidence"]]);
    expect(text).toContain("--- Slide 1 ---");
    expect(text).toContain("--- Slide 3 ---");
    // The empty slide contributes nothing but does not shift the numbering of
    // the ones around it.
    expect(text).not.toContain("--- Slide 2 ---");
    expect(text.indexOf("Title")).toBeLessThan(text.indexOf("A claim"));
  });

  it("keeps a document's paragraphs and drops its empty runs", () => {
    expect(documentToText(["First", "  ", "", "Second"])).toBe("First\nSecond");
  });
});

describe("bounding what is sent", () => {
  it("passes a short file through untouched", () => {
    const reference = normaliseReference("notes.md", "One line.\n\nAnother.");
    expect(reference.text).toBe("One line.\n\nAnother.");
    expect(reference.truncated).toBe(0);
  });

  it("normalises whitespace without eating paragraph breaks", () => {
    const reference = normaliseReference("a.txt", "A  \t line\r\n\r\n\r\n\r\nNext");
    expect(reference.text).toBe("A line\n\nNext");
  });

  it("cuts at a paragraph, not mid-sentence", () => {
    // A reference that stops in the middle of a clause reads to a model as a
    // claim the author made and did not finish.
    const paragraph = `${"word ".repeat(200)}\n\n`;
    const reference = normaliseReference("long.txt", paragraph.repeat(200));
    expect(reference.text.length).toBeLessThanOrEqual(REFERENCE_LIMIT);
    expect(reference.truncated).toBeGreaterThan(0);
    expect(reference.text.endsWith("word")).toBe(true);
  });

  it("still cuts when there is no paragraph break to cut at", () => {
    const reference = normaliseReference("wall.txt", "x".repeat(REFERENCE_LIMIT * 2));
    expect(reference.text.length).toBe(REFERENCE_LIMIT);
    expect(reference.truncated).toBe(REFERENCE_LIMIT);
  });

  it("says how much was left out, in words the author can act on", () => {
    const reference = normaliseReference("book.txt", "x".repeat(REFERENCE_LIMIT * 2));
    expect(describeReference(reference)).toMatch(/too long/i);
    expect(describeReference(normaliseReference("a.txt", "one two three"))).toMatch(/3 words/);
  });
});

/**
 * That the material actually reaches both generations.
 *
 * Read from source, because the claim is about two prompts in one file
 * agreeing — a map grounded in the author's deck, followed by scenes that
 * never saw it, produces a presentation that argues one thing and says
 * another, and every unit test of either half passes while it happens.
 */
describe("both passes are grounded in it", () => {
  const service = readFileSync(join(__dirname, "..", "..", "src/lib/ai/service.ts"), "utf8");

  const bodyOf = (name: string) => {
    const start = service.indexOf(`export async function ${name}(`);
    expect(start, name).toBeGreaterThan(-1);
    const next = service.indexOf("\nexport async function ", start + 1);
    return service.slice(start, next < 0 ? undefined : next);
  };

  it("puts the reference in the map's prompt", () => {
    expect(bodyOf("buildNarrativeMap")).toContain("referenceBlock(context.reference");
  });

  it("puts the same reference in the scenes' prompt", () => {
    expect(bodyOf("buildScenesFromMap")).toContain("referenceBlock(context.reference");
  });

  it("tells both models the author's material outranks what they know", () => {
    expect(bodyOf("buildNarrativeMap")).toMatch(/outranks anything you already know/);
    expect(bodyOf("buildScenesFromMap")).toMatch(/is not to be stated as fact/);
  });

  it("is bounded on the server too, not only in the browser", () => {
    // A client is not a validator: an unbounded string on that boundary is an
    // unbounded prompt, and an unbounded prompt is somebody else's model bill.
    const helpers = readFileSync(
      join(__dirname, "..", "..", "src/lib/ai/route-helpers.ts"),
      "utf8",
    );
    expect(helpers).toContain("REFERENCE_LIMIT");
    expect(helpers).toMatch(/text: z\.string\(\)\.max\(REFERENCE_LIMIT\)/);
  });

  it("is accepted by every route that writes content from it", () => {
    for (const route of ["map", "create-from-map", "scenes-from-map"]) {
      const source = readFileSync(
        join(__dirname, "..", "..", `src/app/api/ai/${route}/route.ts`),
        "utf8",
      );
      expect(source, route).toContain("ReferenceInput");
    }
  });
});

describe("what the model is told", () => {
  it("marks the material as source, not as a script to reproduce", () => {
    // Without this a generation returns the reference back, reformatted,
    // which is not a talk.
    const block = referenceBlock(normaliseReference("Lecture 4.pptx", "The physiology of shock."));
    expect(block).toContain("Lecture 4.pptx");
    expect(block).toContain("<reference>");
    expect(block).toContain("The physiology of shock.");
    expect(block).toMatch(/do not repeat it back/i);
    expect(block).toMatch(/never state anything as fact/i);
  });

  it("tells the model when it is only seeing part of the file", () => {
    const block = referenceBlock(normaliseReference("book.txt", "x".repeat(REFERENCE_LIMIT * 2)));
    expect(block).toMatch(/first part of the file/i);
  });

  it("contributes nothing at all when no file was attached", () => {
    // An empty fence would be an instruction about material that is not there.
    expect(referenceBlock(null)).toBe("");
    expect(referenceBlock({ name: "empty.txt", text: "", truncated: 0 })).toBe("");
  });
});
