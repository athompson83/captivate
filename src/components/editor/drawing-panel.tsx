"use client";

import { useEffect, useState } from "react";
import { Loader2, Sparkles } from "lucide-react";
import type { DrawingElement } from "@/lib/schema/presentation";
import type { GeneratedDrawing } from "@/lib/ai/schemas";
import { aiAvailability } from "@/lib/ai/client";
import { useToast } from "@/components/ui/toast";
import { Field, Segmented, Slider } from "@/components/ui/misc";
import { Textarea } from "@/components/ui/input";

/**
 * The inspector panel for a drawing.
 *
 * Generation replaces the picture wholesale — paths, stages, labels and alt
 * together. A drawing is not hand-edited path by path; the author's controls
 * are the prompt, the pace, the ink and the alt text. Stage labels are shown
 * read-only so the author knows what each press of "next" will add, which is
 * what they rehearse against.
 *
 * The Generate control is absent, not disabled, when no model is configured:
 * an unbuilt path is absent (AGENTS.md), and the placeholder drawing the
 * factory inserts still works without it.
 */
export function DrawingControls({
  element,
  presentationId,
  onPatch,
}: {
  element: DrawingElement;
  presentationId: string | null;
  onPatch: (update: (el: DrawingElement) => DrawingElement, label: string, key?: string) => void;
}) {
  const { toast } = useToast();
  const [prompt, setPrompt] = useState(element.prompt);
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(false);
  useEffect(() => {
    let cancelled = false;
    void aiAvailability().then((a) => {
      if (!cancelled) setConfigured(a.configured);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const generate = async () => {
    const trimmed = prompt.trim();
    if (!trimmed || busy) return;
    setBusy(true);
    const response = await fetch("/api/ai/visuals/draw", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt: trimmed, presentationId }),
    }).catch(() => null);
    const data = (await response?.json().catch(() => null)) as
      | { drawing?: GeneratedDrawing; error?: string }
      | null;
    setBusy(false);

    if (!response?.ok || !data?.drawing) {
      toast({
        tone: "error",
        title: "Couldn't draw that",
        description: data?.error ?? "The model didn't return a drawing. Nothing was changed.",
      });
      return;
    }
    const drawing = data.drawing;
    onPatch(
      (el) => ({
        ...el,
        viewBox: drawing.viewBox,
        paths: drawing.paths,
        stageLabels: drawing.stageLabels,
        prompt: trimmed,
        alt: drawing.alt || el.alt,
      }),
      "Generate drawing",
    );
    toast({
      tone: "success",
      title: "Drawn",
      description: `${stageCount(drawing.paths)} stage${stageCount(drawing.paths) === 1 ? "" : "s"} — each press of next sketches one.`,
    });
  };

  const stages = stageCount(element.paths);

  return (
    <>
      {configured && (
        <Field label="Draw with AI">
          <div className="space-y-2">
            <Textarea
              rows={2}
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="What should the drawing show? e.g. the pathway from airway obstruction to hypoxia"
              aria-label="Drawing prompt"
            />
            <button
              onClick={() => void generate()}
              disabled={busy || !prompt.trim()}
              className="border-line text-ink-2 hover:border-line-strong hover:text-ink flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border py-1.5 text-[12px] font-medium transition-colors disabled:opacity-50"
            >
              {busy ? (
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
              ) : (
                <Sparkles className="size-3.5" aria-hidden />
              )}
              {busy ? "Drawing…" : "Generate drawing"}
            </button>
            <p className="text-ink-3 text-[10.5px]">
              Replaces the whole picture. Line art only — it sketches itself stage by stage while
              you present.
            </p>
          </div>
        </Field>
      )}

      <Field label="Stages">
        <div className="space-y-1">
          <p className="text-ink-2 text-[12px]">
            {stages} stage{stages === 1 ? "" : "s"} · each press of next sketches one
          </p>
          {element.stageLabels.length > 0 && (
            <ol className="text-ink-3 list-decimal space-y-0.5 pl-4 text-[11px]">
              {element.stageLabels.map((label, i) => (
                <li key={i}>{label}</li>
              ))}
            </ol>
          )}
        </div>
      </Field>

      <Field label="Pace">
        <Slider
          label="Seconds per stage"
          min={0.2}
          max={6}
          step={0.1}
          value={element.paceSeconds}
          onChange={(v) =>
            onPatch((el) => ({ ...el, paceSeconds: v }), "Change drawing pace", `pace-${element.id}`)
          }
          format={(v) => `${v.toFixed(1)}s`}
        />
      </Field>

      <Field label="Ink">
        <Segmented
          label="Drawing ink"
          size="sm"
          value={element.ink}
          onChange={(v) => onPatch((el) => ({ ...el, ink: v }), "Change drawing ink")}
          options={[
            { value: "ink" as const, label: "Ink" },
            { value: "accent" as const, label: "Accent" },
            { value: "muted" as const, label: "Muted" },
          ]}
        />
      </Field>

      <Field label="Stroke">
        <Slider
          label="Stroke width"
          min={0.5}
          max={8}
          step={0.5}
          value={element.strokeWidth}
          onChange={(v) =>
            onPatch((el) => ({ ...el, strokeWidth: v }), "Change stroke width", `stroke-${element.id}`)
          }
          format={(v) => String(v)}
        />
      </Field>

      <Field label="Alt text">
        <Textarea
          rows={2}
          value={element.alt}
          onChange={(e) =>
            onPatch((el) => ({ ...el, alt: e.target.value }), "Edit alt text", `alt-${element.id}`)
          }
          placeholder="Describe the finished drawing for screen readers"
          hint="Required for anyone using a screen reader."
        />
      </Field>
    </>
  );
}

function stageCount(paths: { stage: number }[]): number {
  return paths.reduce((top, path) => Math.max(top, path.stage), 0) + 1;
}
