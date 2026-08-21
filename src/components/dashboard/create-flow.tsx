"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  Loader2,
  Pencil,
  RefreshCw,
  Sparkles,
  Wand2,
} from "lucide-react";
import { TEMPLATES } from "@/lib/templates/registry";
import { THEMES, getTheme } from "@/lib/schema/theme";
import type { PresentationOutline } from "@/lib/ai/schemas";
import { requestOutline, requestPresentation } from "@/lib/ai/client";
import { createPresentation } from "@/lib/data/actions";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Segmented, Badge } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";
import { ALL_LAYOUTS } from "@/lib/editor/layouts";

/**
 * Creating a presentation.
 *
 * The AI path deliberately stops at an outline the user can read, edit and
 * regenerate before a single scene is written. Reviewing a twelve-line
 * structure takes fifteen seconds; discovering a bad structure after forty
 * scenes have been generated costs far more.
 */
export function CreateFlow({
  initialMode,
  folders,
  folderId,
}: {
  initialMode: "ai" | "template";
  folders: { id: string; name: string }[];
  folderId: string | null;
}) {
  const [mode, setMode] = useState<"ai" | "template">(initialMode);

  return (
    <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8 sm:py-12">
      <Link
        href="/home"
        className="text-ink-3 hover:text-ink-2 mb-6 inline-flex items-center gap-1.5 text-[13px] transition-colors"
      >
        <ArrowLeft className="size-3.5" aria-hidden />
        Home
      </Link>

      <h1 className="text-ink text-[26px] font-semibold tracking-tight">New presentation</h1>
      <p className="text-ink-3 mt-1.5 text-[14px]">
        Start from a structure, or describe what you need and review the outline first.
      </p>

      <div className="mt-6">
        <Segmented
          label="Creation method"
          value={mode}
          onChange={setMode}
          options={[
            { value: "template", label: "From a template", icon: Pencil },
            { value: "ai", label: "With AI", icon: Sparkles },
          ]}
        />
      </div>

      <div className="mt-6">
        {mode === "template" ? <TemplatePath folders={folders} folderId={folderId} /> : <AiPath />}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

function TemplatePath({
  folders,
  folderId,
}: {
  folders: { id: string; name: string }[];
  folderId: string | null;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [pending, start] = useTransition();

  const [templateId, setTemplateId] = useState("lecture");
  const [title, setTitle] = useState("");
  const [themeId, setThemeId] = useState(
    TEMPLATES.find((t) => t.id === "lecture")?.themeId ?? "midnight",
  );
  const [folder, setFolder] = useState(folderId ?? "");

  const template = TEMPLATES.find((t) => t.id === templateId);

  const create = () =>
    start(async () => {
      const result = await createPresentation({
        title: title.trim() || template?.name || "Untitled presentation",
        themeId,
        templateId,
        folderId: folder || null,
      });
      if (!result.ok) {
        toast({ tone: "error", title: "Couldn't create", description: result.error });
        return;
      }
      router.push(`/edit/${result.data.id}`);
    });

  return (
    <div className="space-y-6">
      <fieldset>
        <legend className="text-ink-3 mb-2.5 text-[11px] font-medium tracking-wider uppercase">
          Structure
        </legend>
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {TEMPLATES.map((t) => (
            <button
              key={t.id}
              onClick={() => {
                setTemplateId(t.id);
                setThemeId(t.themeId);
              }}
              aria-pressed={templateId === t.id}
              className={cn(
                "rounded-[var(--radius-lg)] border p-4 text-left transition-all duration-[var(--duration-fast)]",
                templateId === t.id
                  ? "border-accent bg-[var(--accent-soft)] shadow-[var(--shadow-sm)]"
                  : "border-line-subtle bg-raised hover:border-line",
              )}
            >
              <div className="flex items-center justify-between">
                <span className="text-ink text-[13.5px] font-semibold">{t.name}</span>
                {templateId === t.id && <Check className="text-accent-text size-3.5" aria-hidden />}
              </div>
              <p className="text-ink-3 mt-1.5 text-[12px] leading-relaxed">{t.description}</p>
              <p className="text-ink-3 mt-2.5 text-[11px]">
                {t.scenes.length} {t.scenes.length === 1 ? "scene" : "scenes"} · {t.audience}
              </p>
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <Input
          label="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={template?.name ?? "Untitled presentation"}
          hint="You can change this at any time."
        />
        {folders.length > 0 && (
          <div>
            <label htmlFor="folder" className="text-ink-2 mb-1.5 block text-[13px] font-medium">
              Folder
            </label>
            <select
              id="folder"
              value={folder}
              onChange={(e) => setFolder(e.target.value)}
              className="border-line text-ink focus:border-accent w-full rounded-[var(--radius-md)] border bg-[var(--surface-inset)] px-3 py-2.5 text-sm outline-none"
            >
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <ThemePicker value={themeId} onChange={setThemeId} />

      <div className="flex justify-end">
        <Button variant="primary" size="lg" onClick={create} loading={pending}>
          Create presentation
          <ArrowRight className="size-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */

const AUDIENCES = [
  "University students",
  "EMS and paramedic students",
  "Clinical staff",
  "Corporate team",
  "Investors",
  "Conference audience",
  "Workshop participants",
];

const TONES = ["Clear and direct", "Warm and conversational", "Formal", "Energetic", "Academic"];

function AiPath() {
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState<"prompt" | "outline" | "generating">("prompt");
  const [prompt, setPrompt] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [sceneCount, setSceneCount] = useState(10);
  const [themeId, setThemeId] = useState("midnight");
  const [outline, setOutline] = useState<PresentationOutline | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const buildOutline = async () => {
    if (prompt.trim().length < 8) return;
    setBusy(true);
    setNotice(null);

    const result = await requestOutline({ prompt, audience, tone, sceneCount });
    setBusy(false);

    if (!result.ok) {
      toast({ tone: "error", title: "Couldn't build an outline", description: result.error });
      return;
    }
    setOutline(result.outline);
    setThemeId(result.outline.suggestedThemeId);
    setNotice(result.notice ?? null);
    setStep("outline");
  };

  const generate = async () => {
    if (!outline) return;
    setStep("generating");

    const result = await requestPresentation({ prompt, outline, themeId, audience, tone });

    if (!result.ok) {
      setStep("outline");
      toast({ tone: "error", title: "Generation failed", description: result.error });
      return;
    }

    if (result.notice) {
      toast({ tone: "info", title: "Created with limits", description: result.notice });
    }
    router.push(`/edit/${result.id}`);
  };

  const totalScenes = outline?.sections.reduce((n, s) => n + s.scenes.length, 0) ?? 0;

  return (
    <AnimatePresence mode="wait">
      {step === "prompt" && (
        <motion.div
          key="prompt"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          className="space-y-5"
        >
          <Textarea
            label="What is this presentation about?"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            rows={5}
            autoFocus
            placeholder="A 50-minute lecture on recognising and managing compensated shock for second-year paramedic students. Cover the physiology, the clinical signs that appear before hypotension, and two case examples."
            hint="The more specific you are about the audience and the goal, the better the structure."
          />

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label htmlFor="audience" className="text-ink-2 mb-1.5 block text-[13px] font-medium">
                Audience
              </label>
              <input
                id="audience"
                list="audiences"
                value={audience}
                onChange={(e) => setAudience(e.target.value)}
                placeholder="Who is in the room?"
                className="border-line text-ink placeholder:text-ink-3 focus:border-accent w-full rounded-[var(--radius-md)] border bg-[var(--surface-inset)] px-3 py-2.5 text-sm outline-none"
              />
              <datalist id="audiences">
                {AUDIENCES.map((a) => (
                  <option key={a} value={a} />
                ))}
              </datalist>
            </div>

            <div>
              <label htmlFor="tone" className="text-ink-2 mb-1.5 block text-[13px] font-medium">
                Tone
              </label>
              <input
                id="tone"
                list="tones"
                value={tone}
                onChange={(e) => setTone(e.target.value)}
                placeholder="How should it sound?"
                className="border-line text-ink placeholder:text-ink-3 focus:border-accent w-full rounded-[var(--radius-md)] border bg-[var(--surface-inset)] px-3 py-2.5 text-sm outline-none"
              />
              <datalist id="tones">
                {TONES.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
          </div>

          <div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-ink-2 text-[13px] font-medium">Roughly how many scenes?</span>
              <span className="text-ink-3 text-[13px] tabular-nums">{sceneCount}</span>
            </div>
            <input
              type="range"
              min={4}
              max={24}
              value={sceneCount}
              onChange={(e) => setSceneCount(Number(e.target.value))}
              aria-label="Approximate number of scenes"
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[var(--surface-inset)] accent-[var(--ai)]"
            />
          </div>

          <div className="flex justify-end">
            <Button
              variant="ai"
              size="lg"
              onClick={() => void buildOutline()}
              loading={busy}
              disabled={prompt.trim().length < 8}
            >
              <Wand2 className="size-4" aria-hidden />
              Build an outline
            </Button>
          </div>
        </motion.div>
      )}

      {step === "outline" && outline && (
        <motion.div
          key="outline"
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -6 }}
          transition={{ duration: 0.2 }}
          className="space-y-5"
        >
          {notice && (
            <p
              role="status"
              className="text-ink-2 rounded-[var(--radius-md)] bg-[var(--accent-soft)] px-3.5 py-2.5 text-[12.5px] leading-relaxed"
            >
              {notice}
            </p>
          )}

          <div className="border-line-subtle bg-raised rounded-[var(--radius-lg)] border p-5">
            <input
              value={outline.title}
              onChange={(e) => setOutline({ ...outline, title: e.target.value })}
              aria-label="Presentation title"
              className="text-ink hover:border-line-subtle focus:border-line w-full rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1.5 py-1 text-[19px] font-semibold tracking-tight transition-colors focus:bg-[var(--surface-inset)]"
            />
            {outline.approach && (
              <p className="text-ink-3 mt-1.5 px-1.5 text-[12.5px] leading-relaxed">
                {outline.approach}
              </p>
            )}
            <p className="mt-3 flex items-center gap-2 px-1.5">
              <Badge tone="ai">{totalScenes} scenes</Badge>
              <Badge>{outline.sections.length} sections</Badge>
            </p>
          </div>

          <div className="space-y-4">
            {outline.sections.map((section, sectionIndex) => (
              <section key={sectionIndex}>
                <input
                  value={section.title}
                  onChange={(e) => {
                    const sections = [...outline.sections];
                    sections[sectionIndex] = { ...section, title: e.target.value };
                    setOutline({ ...outline, sections });
                  }}
                  aria-label={`Section ${sectionIndex + 1} title`}
                  className="text-ink-3 hover:border-line-subtle focus:border-line mb-1.5 w-full rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1.5 py-0.5 text-[11px] font-semibold tracking-wider uppercase transition-colors focus:bg-[var(--surface-inset)]"
                />
                <ol className="space-y-1">
                  {section.scenes.map((scene, sceneIndex) => (
                    <li
                      key={sceneIndex}
                      className="border-line-subtle bg-raised flex items-start gap-3 rounded-[var(--radius-md)] border px-3 py-2.5"
                    >
                      <span className="text-ink-3 mt-0.5 shrink-0 rounded bg-[var(--surface-inset)] px-1.5 py-0.5 text-[10px] font-medium">
                        {ALL_LAYOUTS.find((l) => l.value === scene.layout)?.label ?? scene.layout}
                      </span>
                      <span className="min-w-0 flex-1">
                        <input
                          value={scene.title}
                          onChange={(e) => {
                            const sections = [...outline.sections];
                            const scenes = [...section.scenes];
                            scenes[sceneIndex] = { ...scene, title: e.target.value };
                            sections[sectionIndex] = { ...section, scenes };
                            setOutline({ ...outline, sections });
                          }}
                          aria-label={`Scene ${sceneIndex + 1} title`}
                          className="text-ink hover:border-line-subtle focus:border-line w-full rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1 py-0.5 text-[13px] font-medium transition-colors focus:bg-[var(--surface-inset)]"
                        />
                        <span className="text-ink-3 mt-0.5 block px-1 text-[11.5px] leading-snug">
                          {scene.purpose}
                        </span>
                      </span>
                      <button
                        onClick={() => {
                          const sections = [...outline.sections];
                          const scenes = section.scenes.filter((_, i) => i !== sceneIndex);
                          if (scenes.length === 0) {
                            setOutline({
                              ...outline,
                              sections: sections.filter((_, i) => i !== sectionIndex),
                            });
                            return;
                          }
                          sections[sectionIndex] = { ...section, scenes };
                          setOutline({ ...outline, sections });
                        }}
                        aria-label={`Remove ${scene.title}`}
                        className="text-ink-3 hover:text-danger mt-0.5 shrink-0 rounded p-1 transition-colors"
                      >
                        ×
                      </button>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>

          <ThemePicker value={themeId} onChange={setThemeId} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStep("prompt")}>
                <ArrowLeft className="size-3.5" aria-hidden />
                Change the brief
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => void buildOutline()}
                loading={busy}
              >
                <RefreshCw className="size-3.5" aria-hidden />
                Try a different structure
              </Button>
            </div>
            <Button variant="ai" size="lg" onClick={() => void generate()}>
              <Sparkles className="size-4" aria-hidden />
              Write {totalScenes} scenes
            </Button>
          </div>
        </motion.div>
      )}

      {step === "generating" && (
        <motion.div
          key="generating"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="flex flex-col items-center justify-center py-20 text-center"
        >
          <Loader2 className="text-ai size-6 animate-spin" aria-hidden />
          <p className="text-ink mt-4 text-[15px] font-medium">Writing {totalScenes} scenes</p>
          <p className="text-ink-3 mt-1.5 max-w-sm text-[13px] leading-relaxed">
            Each scene is composed into a designed layout, not just filled with text. This usually
            takes half a minute.
          </p>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/* -------------------------------------------------------------------------- */

function ThemePicker({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <fieldset>
      <legend className="text-ink-3 mb-2.5 text-[11px] font-medium tracking-wider uppercase">
        Theme
      </legend>
      <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3 lg:grid-cols-6">
        {THEMES.map((theme) => {
          const active = theme.id === value;
          return (
            <button
              key={theme.id}
              onClick={() => onChange(theme.id)}
              aria-pressed={active}
              title={theme.description}
              className={cn(
                "overflow-hidden rounded-[var(--radius-md)] border text-left transition-all duration-[var(--duration-fast)]",
                active
                  ? "border-accent shadow-[var(--shadow-sm)]"
                  : "border-line-subtle hover:border-line",
              )}
            >
              <span
                className="flex h-14 items-end gap-1 p-2.5"
                style={{ background: getTheme(theme.id).tokens.canvas }}
              >
                <span
                  className="h-1.5 w-8 rounded-full"
                  style={{ background: theme.tokens.accent }}
                  aria-hidden
                />
                <span
                  className="h-1.5 w-4 rounded-full"
                  style={{ background: theme.tokens.inkMuted }}
                  aria-hidden
                />
              </span>
              <span className="text-ink block px-2.5 py-1.5 text-[11.5px] font-medium">
                {theme.name}
              </span>
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
