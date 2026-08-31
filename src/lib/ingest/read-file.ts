"use client";

import JSZip from "jszip";
import {
  deckToText,
  documentToText,
  formatOf,
  normaliseReference,
  orderSlideParts,
  refusalFor,
  textFromOoxmlPart,
  type Reference,
} from "./reference";

/**
 * The browser half of reading a reference: unzip, decode, hand the strings to
 * `reference.ts`. It decides nothing — every rule about what survives lives
 * there, where it can be tested without a file or a DOM.
 *
 * Nothing is uploaded. A `.pptx` is a zip of XML and a `.docx` is the same
 * shape, so both are read here with the copy of JSZip that already ships, and
 * the server never sees the file — only the bounded text the author agreed to
 * send. Parsing a document somebody was handed is an attack surface, and the
 * safest place for it is the tab it was dropped into.
 */

export type ReadResult = { ok: true; reference: Reference } | { ok: false; error: string };

/** A conservative ceiling on what is worth opening at all. */
const MAX_BYTES = 25 * 1024 * 1024;

/** OOXML files are zips; a zip begins "PK". Checked before trusting a name. */
function looksLikeZip(bytes: Uint8Array): boolean {
  return bytes[0] === 0x50 && bytes[1] === 0x4b;
}

async function readOoxml(file: File, tag: "a:t" | "w:t"): Promise<ReadResult> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (!looksLikeZip(bytes)) {
    return {
      ok: false,
      error: `${file.name} isn't the format its name says it is, so it wasn't opened.`,
    };
  }

  const zip = await JSZip.loadAsync(bytes);

  if (tag === "a:t") {
    const slides = orderSlideParts(Object.keys(zip.files));
    if (slides.length === 0) {
      return { ok: false, error: `${file.name} has no slides in it.` };
    }
    const perSlide: string[][] = [];
    for (const path of slides) {
      const xml = await zip.file(path)!.async("string");
      perSlide.push(textFromOoxmlPart(xml, "a:t"));
    }
    return finish(file.name, deckToText(perSlide));
  }

  const part = zip.file("word/document.xml");
  if (!part) return { ok: false, error: `${file.name} doesn't contain a document.` };
  const xml = await part.async("string");
  return finish(file.name, documentToText(textFromOoxmlPart(xml, "w:t")));
}

function finish(name: string, text: string): ReadResult {
  const reference = normaliseReference(name, text);
  if (!reference.text) {
    return { ok: false, error: `${name} had no readable text in it.` };
  }
  return { ok: true, reference };
}

/** Read a file the author picked, or say plainly why it could not be read. */
export async function readReference(file: File): Promise<ReadResult> {
  const refusal = refusalFor(file.name);
  if (refusal) return { ok: false, error: refusal };

  if (file.size > MAX_BYTES) {
    return { ok: false, error: `${file.name} is too large to read here.` };
  }

  try {
    const format = formatOf(file.name);
    if (format === "pptx") return await readOoxml(file, "a:t");
    if (format === "docx") return await readOoxml(file, "w:t");
    return finish(file.name, await file.text());
  } catch {
    return { ok: false, error: `${file.name} couldn't be read. It may be damaged.` };
  }
}
