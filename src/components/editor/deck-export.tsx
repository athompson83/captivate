"use client";

import { useState } from "react";
import { FileDown, Loader2 } from "lucide-react";
import { useEditor } from "@/lib/editor/store";
import { getTheme } from "@/lib/schema/theme";
import { describeOmissions, planDeck } from "@/lib/export/deck-plan";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast";

/**
 * Export the deck as a file PowerPoint and Keynote both open.
 *
 * The dialog says what will not survive **before** the download rather than
 * after it. Flattening a journey into slides loses the camera, the build
 * steps and anything a slide cannot play, and a presenter who discovers that
 * ten minutes before a talk has been failed by this feature. So the plan is
 * computed first — it is cheap and needs no network — and its omissions are
 * shown as the thing you press through.
 *
 * pptxgenjs and the file it writes are loaded only when somebody actually
 * exports: it is a large library serving a button most sessions never touch.
 */
export function DeckExport({ onDone }: { onDone?: () => void }) {
  const presentation = useEditor((s) => s.document.presentation);
  const scenes = useEditor((s) => s.document.scenes);
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const plan = planDeck(presentation, scenes, getTheme(presentation.themeId));
  const losses = describeOmissions(plan.omissions);

  const download = async () => {
    setBusy(true);
    try {
      const { buildPptx, deckFileName } = await import("@/lib/export/pptx");
      const blob = await buildPptx(plan, presentation.title);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = deckFileName(presentation.title);
      anchor.click();
      // Revoked on the next tick rather than immediately: a click handler that
      // frees the object URL in the same task can beat the download starting.
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
      onDone?.();
    } catch (error) {
      toast({
        tone: "error",
        title: "Couldn't build the file",
        description: error instanceof Error ? error.message : "Nothing was changed.",
      });
    } finally {
      setBusy(false);
    }
  };

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="text-ink-3 hover:text-ink inline-flex items-center gap-1.5 text-[12px] font-medium transition-colors"
      >
        <FileDown className="size-3.5" aria-hidden />
        Export to PowerPoint or Keynote
      </button>
    );
  }

  return (
    <div className="space-y-2.5">
      <p className="text-ink-2 text-[12px] leading-relaxed">
        {plan.slides.length} slide{plan.slides.length === 1 ? "" : "s"}, sized {plan.aspect}.
        Keynote opens the same file.
      </p>
      <p className="text-ink-3 text-[12px] leading-relaxed">
        A deck is linear, so the camera does not travel and the scenes become pages. Hotspots become
        links between slides, and speaker notes come with them.
      </p>
      {losses.length > 0 && (
        <ul className="text-ink-3 space-y-1 text-[12px] leading-relaxed">
          {losses.map((line) => (
            <li key={line} className="flex gap-1.5">
              <span aria-hidden>—</span>
              <span>{line}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex items-center gap-2">
        <Button variant="primary" size="sm" disabled={busy} onClick={() => void download()}>
          {busy ? (
            <Loader2 className="size-3.5 animate-spin" aria-hidden />
          ) : (
            <FileDown className="size-3.5" aria-hidden />
          )}
          {busy ? "Building…" : "Download .pptx"}
        </Button>
        <Button variant="ghost" size="sm" disabled={busy} onClick={() => setConfirming(false)}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
