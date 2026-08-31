import PptxGenJS from "pptxgenjs";
import { readReference } from "@/lib/ingest/read-file";

/**
 * Reads a real `.pptx` back into text, in a real browser.
 *
 * The extraction rules are unit-tested against XML strings. What that cannot
 * show is whether a file PowerPoint actually wrote — a zip, with its parts
 * named and ordered the way the format really names them — comes back as the
 * author's words in the author's order. So this builds one with the same
 * writer the export uses, hands it to the reader, and returns what came out.
 *
 * No server and no account.
 */

declare global {
  interface Window {
    roundTrip: () => Promise<{ ok: boolean; text: string; name: string; error?: string }>;
    /** Reads bytes the test supplies, so a hostile file can be tried too. */
    readBytes: (
      name: string,
      contents: string,
    ) => Promise<{ ok: boolean; error?: string; text?: string }>;
  }
}

async function makeDeck(): Promise<File> {
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_16x9";

  const first = pptx.addSlide();
  first.addText("Shock is a clinical diagnosis", { x: 1, y: 1, w: 8, h: 1, fontSize: 32 });
  first.addText("Perfusion, not pressure", { x: 1, y: 2.4, w: 8, h: 0.8, fontSize: 18 });

  const second = pptx.addSlide();
  second.addText("Compensation & its limits", { x: 1, y: 1, w: 8, h: 1, fontSize: 28 });

  // Ten slides, so the reader is forced to order slide10 after slide2 rather
  // than sorting the parts as strings.
  for (let i = 3; i <= 10; i += 1) {
    pptx.addSlide().addText(`Beat number ${i}`, { x: 1, y: 1, w: 8, h: 1, fontSize: 24 });
  }

  const blob = (await pptx.write({ outputType: "blob" })) as Blob;
  return new File([blob], "Lecture 4.pptx", { type: blob.type });
}

window.roundTrip = async () => {
  const result = await readReference(await makeDeck());
  if (!result.ok) return { ok: false, text: "", name: "", error: result.error };
  return { ok: true, text: result.reference.text, name: result.reference.name };
};

window.readBytes = async (name, contents) => {
  const result = await readReference(new File([contents], name));
  return result.ok ? { ok: true, text: result.reference.text } : { ok: false, error: result.error };
};

document.body.dataset.ready = "true";
