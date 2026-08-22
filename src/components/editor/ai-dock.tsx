"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import {
  ArrowRight,
  Check,
  Image as ImageIcon,
  Loader2,
  RotateCcw,
  Sparkles,
  Wand2,
  X,
} from "lucide-react";
import { plainText, type SceneElement } from "@/lib/schema/presentation";
import { REWRITE_LABELS, type RewriteMode } from "@/lib/ai/schemas";
import { aiConfigured, requestRewrite, requestScene, requestVisuals } from "@/lib/ai/client";
import {
  editElement,
  insertScene,
  useCurrentScene,
  useEditor,
  useSelectedElements,
} from "@/lib/editor/store";
import { addScene } from "@/lib/data/actions";
import { Textarea } from "@/components/ui/input";
import { Badge, Segmented } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";

/**
 * Contextual AI panel.
 *
 * What it offers depends on what is selected: text tools when text is
 * selected, scene generation otherwise. Nothing is applied automatically —
 * every result is a proposal the user accepts, which is the difference between
 * AI that saves work and AI that creates cleanup.
 */
export function AiDock({
  presentationId,
  onClose,
}: {
  presentationId: string;
  onClose: () => void;
}) {
  const selected = useSelectedElements();
  const scene = useCurrentScene();
  const scenes = useEditor((s) => s.document.scenes);
  const title = useEditor((s) => s.document.presentation.title);
  const [configured, setConfigured] = useState<boolean | null>(null);

  useEffect(() => {
    void aiConfigured().then(setConfigured);
  }, []);

  const textElement = selected.find(
    (e): e is Extract<SceneElement, { type: "heading" | "text" | "quote" | "list" }> =>
      e.type === "heading" || e.type === "text" || e.type === "quote" || e.type === "list",
  );

  return (
    <motion.aside
      aria-label="AI assistant"
      initial={{ width: 0, opacity: 0 }}
      animate={{ width: 320, opacity: 1 }}
      exit={{ width: 0, opacity: 0 }}
      transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
      className="border-line-subtle bg-base shrink-0 overflow-hidden border-l"
    >
      <div className="flex h-full w-[320px] flex-col">
        <div className="border-line-subtle flex shrink-0 items-center justify-between border-b px-3.5 py-2.5">
          <span className="text-ink flex items-center gap-2 text-[13px] font-medium">
            <Sparkles className="text-ai size-3.5" aria-hidden />
            AI
          </span>
          <button
            onClick={onClose}
            aria-label="Close AI panel"
            className="text-ink-3 hover:text-ink rounded p-1 transition-colors"
          >
            <X className="size-3.5" aria-hidden />
          </button>
        </div>

        {configured === false && (
          <div className="border-line-subtle border-b bg-[var(--accent-soft)] px-3.5 py-2.5">
            <p className="text-ink-2 text-[11.5px] leading-relaxed">
              No language model is configured on this deployment. Text tools fall back to simple
              rules, and generated scenes are structural placeholders rather than written content.
            </p>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-y-auto p-3.5">
          {textElement ? (
            <TextTools
              element={textElement}
              sceneId={scene?.id ?? ""}
              presentationId={presentationId}
            />
          ) : (
            <SceneTools
              presentationId={presentationId}
              presentationTitle={title}
              currentSceneId={scene?.id ?? null}
              sceneTitles={scenes.map((s) => s.title || "Untitled")}
            />
          )}

          {scene && !textElement && <VisualTools presentationId={presentationId} />}
        </div>
      </div>
    </motion.aside>
  );
}

/* -------------------------------------------------------------------------- */

function TextTools({
  element,
  sceneId,
  presentationId,
}: {
  element: Extract<SceneElement, { type: "heading" | "text" | "quote" | "list" }>;
  sceneId: string;
  presentationId: string;
}) {
  const { toast } = useToast();
  const [busy, setBusy] = useState<RewriteMode | null>(null);
  const [options, setOptions] = useState<string[] | null>(null);
  const [original, setOriginal] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);

  const currentText =
    element.type === "list"
      ? element.items.map((i) => plainText(i)).join("\n")
      : plainText(element.content);

  const run = async (mode: RewriteMode) => {
    abort.current?.abort();
    abort.current = new AbortController();
    setBusy(mode);
    setOptions(null);

    const result = await requestRewrite(
      { text: currentText, mode, presentationId },
      abort.current.signal,
    );
    setBusy(null);

    if (!result.ok) {
      if (result.error !== "Cancelled.") {
        toast({ tone: "error", title: "Couldn't rewrite", description: result.error });
      }
      return;
    }
    setOptions(result.options);
  };

  const apply = (text: string) => {
    setOriginal(currentText);
    editElement(
      sceneId,
      element.id,
      (el) => {
        if (el.type === "list") {
          return {
            ...el,
            items: text
              .split("\n")
              .filter(Boolean)
              .slice(0, 24)
              .map((line) => [{ text: line.replace(/^[-•*]\s*/, "") }]),
          };
        }
        if (el.type === "heading" || el.type === "text" || el.type === "quote") {
          const [first] = el.content;
          return { ...el, content: [{ ...(first ?? {}), text }] };
        }
        return el;
      },
      { label: "Apply AI rewrite" },
    );
    setOptions(null);
    toast({
      tone: "success",
      title: "Applied",
      description: "Undo with ⌘Z if it isn't right.",
    });
  };

  const revert = () => {
    if (original === null) return;
    apply(original);
    setOriginal(null);
  };

  return (
    <div className="space-y-4">
      <div>
        <p className="text-ink-3 mb-1.5 text-[10px] font-medium tracking-wider uppercase">
          Selected text
        </p>
        <p className="border-line-subtle text-ink-2 max-h-24 overflow-y-auto rounded-[var(--radius-md)] border bg-[var(--surface-inset)] p-2.5 text-[12px] leading-relaxed">
          {currentText || <span className="text-ink-3">This element is empty.</span>}
        </p>
      </div>

      <div className="grid grid-cols-2 gap-1.5">
        {(Object.keys(REWRITE_LABELS) as RewriteMode[]).map((mode) => (
          <button
            key={mode}
            onClick={() => void run(mode)}
            disabled={!currentText.trim() || busy !== null}
            className={cn(
              "flex items-center justify-center gap-1.5 rounded-[var(--radius-md)] border px-2 py-1.5 text-[11.5px] font-medium transition-colors",
              "border-line-subtle text-ink-2 hover:border-ai hover:text-ai-text",
              "disabled:pointer-events-none disabled:opacity-40",
            )}
          >
            {busy === mode ? <Loader2 className="size-3 animate-spin" aria-hidden /> : null}
            {REWRITE_LABELS[mode].label}
          </button>
        ))}
      </div>

      {options && (
        <div className="space-y-2">
          <p className="text-ink-3 text-[10px] font-medium tracking-wider uppercase">
            {options.length === 1 ? "Suggestion" : `${options.length} options`}
          </p>
          {options.map((option, i) => (
            <div
              key={i}
              className="border-line-subtle rounded-[var(--radius-md)] border bg-[var(--surface-inset)] p-2.5"
            >
              <p className="text-ink text-[12px] leading-relaxed">{option}</p>
              <button
                onClick={() => apply(option)}
                className="text-ai-text mt-2 flex items-center gap-1.5 text-[11.5px] font-medium hover:underline"
              >
                <Check className="size-3" aria-hidden />
                Use this
              </button>
            </div>
          ))}
          <button
            onClick={() => setOptions(null)}
            className="text-ink-3 hover:text-ink-2 w-full text-[11.5px]"
          >
            Dismiss
          </button>
        </div>
      )}

      {original !== null && (
        <button
          onClick={revert}
          className="border-line text-ink-2 hover:border-line-strong hover:text-ink flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border py-1.5 text-[11.5px] transition-colors"
        >
          <RotateCcw className="size-3" aria-hidden />
          Restore the original
        </button>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function SceneTools({
  presentationId,
  presentationTitle,
  currentSceneId,
  sceneTitles,
}: {
  presentationId: string;
  presentationTitle: string;
  currentSceneId: string | null;
  sceneTitles: string[];
}) {
  const { toast } = useToast();
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [placement, setPlacement] = useState<"after" | "end">("after");

  const generate = async () => {
    if (!instruction.trim()) return;
    setBusy(true);

    const result = await requestScene({
      instruction,
      presentationId,
      presentationTitle,
      neighbouring: sceneTitles.slice(0, 6),
    });

    if (!result.ok) {
      setBusy(false);
      toast({ tone: "error", title: "Couldn't generate a scene", description: result.error });
      return;
    }

    const generated = result.scenes[0];
    const anchor = placement === "after" ? currentSceneId : null;

    const added = await addScene({
      presentationId,
      afterSceneId: anchor,
      title: generated.title,
      content: generated.content,
      speakerNotes: generated.speakerNotes,
    });
    setBusy(false);

    if (!added.ok) {
      toast({ tone: "error", title: "Couldn't add the scene", description: added.error });
      return;
    }

    const now = new Date().toISOString();
    insertScene(
      {
        id: added.data.id,
        presentationId,
        sectionId: null,
        position: added.data.position,
        title: generated.title,
        content: generated.content,
        placement: null,
        momentId: null,
        speakerNotes: generated.speakerNotes,
        durationSeconds: null,
        createdAt: now,
        updatedAt: now,
      },
      anchor,
    );

    setInstruction("");
    toast({
      tone: "success",
      title: "Scene added",
      description:
        result.source === "fallback"
          ? "Structural placeholder — edit the wording."
          : "Edit it like any other scene.",
    });
  };

  return (
    <div className="space-y-3">
      <div>
        <p className="text-ink-3 mb-1.5 text-[10px] font-medium tracking-wider uppercase">
          Generate a scene
        </p>
        <Textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          placeholder="A scene comparing compensated and decompensated shock, with the key signs for each."
          aria-label="What the scene should do"
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") void generate();
          }}
        />
      </div>

      <Segmented
        label="Where to place it"
        size="sm"
        value={placement}
        onChange={setPlacement}
        options={[
          { value: "after", label: "After this scene" },
          { value: "end", label: "At the end" },
        ]}
      />

      <button
        onClick={() => void generate()}
        disabled={busy || !instruction.trim()}
        className="bg-ai flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] py-2 text-[12.5px] font-medium text-white transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-40"
      >
        {busy ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Wand2 className="size-3.5" aria-hidden />
        )}
        {busy ? "Writing…" : "Generate scene"}
      </button>

      <p className="text-ink-3 text-[10.5px] leading-relaxed">
        Generated scenes are inserted as ordinary editable scenes. Nothing existing is replaced.
      </p>

      <div className="border-line-subtle border-t pt-3">
        <p className="text-ink-3 mb-1.5 text-[10px] font-medium tracking-wider uppercase">
          Select some text
        </p>
        <p className="text-ink-3 text-[11.5px] leading-relaxed">
          Select a heading, paragraph or list on the canvas to rewrite, shorten, expand or simplify
          it.
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function VisualTools({ presentationId }: { presentationId: string }) {
  const scene = useCurrentScene();
  const { toast } = useToast();
  const [busy, setBusy] = useState(false);
  const [suggestions, setSuggestions] = useState<
    { description: string; placement: string; altText: string }[] | null
  >(null);

  if (!scene) return null;

  const sceneText = scene.content.elements
    .map((el) =>
      el.type === "heading" || el.type === "text" || el.type === "quote"
        ? plainText(el.content)
        : el.type === "list"
          ? el.items.map((i) => plainText(i)).join(" · ")
          : "",
    )
    .filter(Boolean)
    .join("\n");

  const run = async () => {
    setBusy(true);
    const result = await requestVisuals({ title: scene.title, text: sceneText, presentationId });
    setBusy(false);
    if (!result.ok) {
      toast({ tone: "error", title: "Couldn't suggest visuals", description: result.error });
      return;
    }
    setSuggestions(result.suggestions);
  };

  return (
    <div className="border-line-subtle mt-5 border-t pt-4">
      <button
        onClick={() => void run()}
        disabled={busy || !sceneText.trim()}
        className="border-line text-ink-2 hover:border-ai hover:text-ai-text flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border py-1.5 text-[11.5px] font-medium transition-colors disabled:pointer-events-none disabled:opacity-40"
      >
        {busy ? (
          <Loader2 className="size-3 animate-spin" aria-hidden />
        ) : (
          <ImageIcon className="size-3" aria-hidden />
        )}
        Suggest visuals for this scene
      </button>

      {suggestions && (
        <ul className="mt-2.5 space-y-2">
          {suggestions.map((s, i) => (
            <li
              key={i}
              className="border-line-subtle rounded-[var(--radius-md)] border bg-[var(--surface-inset)] p-2.5"
            >
              <p className="text-ink text-[12px] leading-relaxed">{s.description}</p>
              <div className="mt-1.5 flex items-center gap-2">
                <Badge tone="ai">{s.placement.replace("-", " ")}</Badge>
                <button
                  onClick={() => {
                    void navigator.clipboard?.writeText(s.description);
                    toast({
                      tone: "success",
                      title: "Copied",
                      description: "Use it to search or commission an image.",
                    });
                  }}
                  className="text-ink-3 hover:text-ink-2 flex items-center gap-1 text-[11px]"
                >
                  Copy prompt
                  <ArrowRight className="size-2.5" aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-ink-3 mt-2 text-[10.5px] leading-relaxed">
        Captivate suggests what a picture should show. Generating images costs money, so it never
        happens automatically — upload your own, or use a suggestion as a search prompt.
      </p>
    </div>
  );
}
