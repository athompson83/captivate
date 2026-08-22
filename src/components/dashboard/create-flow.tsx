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
import type { ProposedMap } from "@/lib/ai/schemas";
import { ROLE_META, ROLE_ORDER } from "@/lib/schema/narrative";
import type { AvailableEvidence } from "@/lib/narrative/generate";
import { requestMap, requestPresentationFromMap } from "@/lib/ai/client";
import { createPresentation } from "@/lib/data/actions";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { Segmented, Badge } from "@/components/ui/misc";
import { useToast } from "@/components/ui/toast";
import { cn } from "@/lib/utils/cn";

/**
 * Creating a presentation.
 *
 * The AI path stops at a narrative map: what each movement and moment has to
 * accomplish, which the author reads, edits and regenerates before a single
 * scene exists. Reviewing an argument takes a minute; discovering a bad
 * argument after forty scenes have been written costs far more — and the map
 * is not thrown away afterwards, it stays as the thing scenes are generated
 * from.
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
        Start from a structure, or describe what you need and shape the argument before anything is
        written.
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
        {mode === "template" ? (
          <TemplatePath folders={folders} folderId={folderId} />
        ) : (
          <AiPath folderId={folderId} />
        )}
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

function AiPath({ folderId }: { folderId: string | null }) {
  const router = useRouter();
  const { toast } = useToast();

  const [step, setStep] = useState<"brief" | "map" | "generating">("brief");
  const [prompt, setPrompt] = useState("");
  const [audience, setAudience] = useState("");
  const [tone, setTone] = useState("");
  const [minutes, setMinutes] = useState(20);
  const [depth, setDepth] = useState<"outline" | "full">("full");
  const [themeId, setThemeId] = useState("midnight");
  const [map, setMap] = useState<ProposedMap | null>(null);
  const [available, setAvailable] = useState<AvailableEvidence[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const totalSeconds = minutes * 60;

  const buildMap = async () => {
    if (prompt.trim().length < 8) return;
    setBusy(true);
    setNotice(null);

    const result = await requestMap({ prompt, audience, tone, totalSeconds });
    setBusy(false);

    if (!result.ok) {
      toast({ tone: "error", title: "Couldn't build a map", description: result.error });
      return;
    }
    setMap(result.proposal);
    setAvailable(result.available);
    setThemeId(result.proposal.suggestedThemeId);
    setNotice(result.notice ?? null);
    setStep("map");
  };

  const generate = async () => {
    if (!map) return;
    setStep("generating");

    const result = await requestPresentationFromMap({
      prompt,
      map,
      totalSeconds,
      depth,
      themeId,
      folderId,
      audience,
      tone,
    });

    if (!result.ok) {
      setStep("map");
      toast({ tone: "error", title: "Generation failed", description: result.error });
      return;
    }

    if (result.droppedEvidence > 0) {
      toast({
        tone: "info",
        title: "Some references were dropped",
        description: `${result.droppedEvidence} source${result.droppedEvidence === 1 ? "" : "s"} named in the map couldn't be found in your workspace, so nothing was attached for ${result.droppedEvidence === 1 ? "it" : "them"}.`,
      });
    }
    if (result.notice) {
      toast({ tone: "info", title: "Created with limits", description: result.notice });
    }
    router.push(`/edit/${result.id}`);
  };

  const momentCount = map?.movements.reduce((n, m) => n + m.moments.length, 0) ?? 0;

  /** Replaces one movement, leaving the rest of the argument alone. */
  const patchMovement = (index: number, patch: Partial<ProposedMap["movements"][number]>) => {
    if (!map) return;
    const movements = [...map.movements];
    movements[index] = { ...movements[index], ...patch };
    setMap({ ...map, movements });
  };

  const patchMoment = (
    movementIndex: number,
    momentIndex: number,
    patch: Partial<ProposedMap["movements"][number]["moments"][number]>,
  ) => {
    if (!map) return;
    const moments = [...map.movements[movementIndex].moments];
    moments[momentIndex] = { ...moments[momentIndex], ...patch };
    patchMovement(movementIndex, { moments });
  };

  const removeMoment = (movementIndex: number, momentIndex: number) => {
    if (!map) return;
    const moments = map.movements[movementIndex].moments.filter((_, i) => i !== momentIndex);
    // A movement with nothing left in it is no longer a stretch of argument.
    if (moments.length === 0) {
      setMap({ ...map, movements: map.movements.filter((_, i) => i !== movementIndex) });
      return;
    }
    patchMovement(movementIndex, { moments });
  };

  return (
    <AnimatePresence mode="wait">
      {step === "brief" && (
        <motion.div
          key="brief"
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
            hint="Say what has to change in the room by the end. That is what the argument is built around."
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
              <span className="text-ink-2 text-[13px] font-medium">How long do you have?</span>
              <span className="text-ink-3 text-[13px] tabular-nums">{minutes} min</span>
            </div>
            <input
              type="range"
              min={5}
              max={120}
              step={5}
              value={minutes}
              onChange={(e) => setMinutes(Number(e.target.value))}
              aria-label="Planned running time in minutes"
              className="h-1 w-full cursor-pointer appearance-none rounded-full bg-[var(--surface-inset)] accent-[var(--ai)]"
            />
            <p className="text-ink-3 mt-1.5 text-[11.5px] leading-relaxed">
              This decides the shape of the argument, not the number of scenes. You can change it on
              the map afterwards.
            </p>
          </div>

          <div className="flex justify-end">
            <Button
              variant="ai"
              size="lg"
              onClick={() => void buildMap()}
              loading={busy}
              disabled={prompt.trim().length < 8}
            >
              <Wand2 className="size-4" aria-hidden />
              Plan the argument
            </Button>
          </div>
        </motion.div>
      )}

      {step === "map" && map && (
        <motion.div
          key="map"
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
            {/* A textarea rather than an input: a derived title is often a full
                clause, and a single-line field clips it at the box edge where
                it reads as truncated data rather than an editable title. */}
            <textarea
              value={map.title}
              onChange={(e) => setMap({ ...map, title: e.target.value.replace(/\n/g, " ") })}
              rows={1}
              aria-label="Presentation title"
              className="text-ink hover:border-line-subtle focus:border-line field-sizing-content w-full resize-none rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1.5 py-1 text-[19px] leading-snug font-semibold tracking-tight transition-colors focus:bg-[var(--surface-inset)]"
            />
            {map.approach && (
              <p className="text-ink-3 mt-1.5 px-1.5 text-[12.5px] leading-relaxed">
                {map.approach}
              </p>
            )}
            <p className="mt-3 flex flex-wrap items-center gap-2 px-1.5">
              <Badge tone="ai">{map.movements.length} movements</Badge>
              <Badge>{momentCount} moments</Badge>
              <Badge>{minutes} min</Badge>
            </p>
          </div>

          <div className="space-y-6">
            {map.movements.map((movement, movementIndex) => (
              <section key={movementIndex}>
                <div className="mb-2 flex flex-wrap items-center gap-2">
                  <input
                    value={movement.label}
                    onChange={(e) =>
                      patchMovement(movementIndex, { label: e.target.value.slice(0, 24) })
                    }
                    aria-label={`Short label for movement ${movementIndex + 1}`}
                    className="border-accent/30 text-accent focus:border-accent w-[124px] rounded-full border bg-[var(--accent-soft)] px-2.5 py-0.5 text-[10.5px] font-medium tracking-[0.14em] uppercase outline-none"
                  />
                  <input
                    value={movement.title}
                    onChange={(e) => patchMovement(movementIndex, { title: e.target.value })}
                    aria-label={`Movement ${movementIndex + 1} title`}
                    className="text-ink hover:border-line-subtle focus:border-line min-w-0 flex-1 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1 py-0.5 text-[15px] font-semibold tracking-tight transition-colors focus:bg-[var(--surface-inset)]"
                  />
                </div>

                <textarea
                  value={movement.purpose}
                  onChange={(e) => patchMovement(movementIndex, { purpose: e.target.value })}
                  rows={1}
                  aria-label={`What movement ${movementIndex + 1} accomplishes`}
                  className="text-ink-3 hover:border-line-subtle focus:border-line mb-2 field-sizing-content w-full resize-none rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1 py-0.5 text-[12.5px] leading-snug transition-colors focus:bg-[var(--surface-inset)]"
                />

                <ol className="space-y-1.5">
                  {movement.moments.map((moment, momentIndex) => (
                    <li
                      key={momentIndex}
                      className="border-line-subtle bg-raised rounded-[var(--radius-md)] border px-3 py-2.5"
                    >
                      <div className="flex items-start gap-2.5">
                        <select
                          value={moment.role}
                          onChange={(e) =>
                            patchMoment(movementIndex, momentIndex, {
                              role: e.target
                                .value as ProposedMap["movements"][number]["moments"][number]["role"],
                            })
                          }
                          aria-label={`What moment ${momentIndex + 1} does`}
                          title={ROLE_META[moment.role].plain}
                          className="border-line text-ink-2 focus:border-accent mt-0.5 shrink-0 rounded-[var(--radius-sm)] border bg-[var(--surface-inset)] px-1.5 py-1 text-[10.5px] font-medium outline-none"
                        >
                          {ROLE_ORDER.map((role) => (
                            <option key={role} value={role}>
                              {ROLE_META[role].label}
                            </option>
                          ))}
                        </select>

                        <div className="min-w-0 flex-1">
                          <input
                            value={moment.title}
                            onChange={(e) =>
                              patchMoment(movementIndex, momentIndex, { title: e.target.value })
                            }
                            aria-label={`Moment ${momentIndex + 1} title`}
                            className="text-ink hover:border-line-subtle focus:border-line w-full rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1 py-0.5 text-[13px] font-medium transition-colors focus:bg-[var(--surface-inset)]"
                          />
                          <textarea
                            value={moment.purpose}
                            onChange={(e) =>
                              patchMoment(movementIndex, momentIndex, { purpose: e.target.value })
                            }
                            rows={1}
                            aria-label={`Why moment ${momentIndex + 1} exists`}
                            className="text-ink-3 hover:border-line-subtle focus:border-line mt-0.5 field-sizing-content w-full resize-none rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1 py-0.5 text-[11.5px] leading-snug transition-colors focus:bg-[var(--surface-inset)]"
                          />
                          <p className="text-ink-3 mt-1 flex items-start gap-1.5 px-1 text-[11.5px] leading-snug">
                            <span className="text-ink-3/70 shrink-0">They leave with</span>
                            <input
                              value={moment.takeaway}
                              onChange={(e) =>
                                patchMoment(movementIndex, momentIndex, {
                                  takeaway: e.target.value,
                                })
                              }
                              aria-label={`What the audience takes from moment ${momentIndex + 1}`}
                              className="text-ink-2 hover:border-line-subtle focus:border-line min-w-0 flex-1 rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1 py-0 text-[11.5px] italic transition-colors focus:bg-[var(--surface-inset)]"
                            />
                          </p>
                          {moment.evidenceIds.length > 0 && (
                            <p className="text-ink-3 mt-1 px-1 text-[11px]">
                              Grounded by{" "}
                              {moment.evidenceIds
                                .map(
                                  (id) =>
                                    available.find((item) => item.id === id)?.label ??
                                    "an unknown source",
                                )
                                .join(", ")}
                            </p>
                          )}
                        </div>

                        <button
                          onClick={() => removeMoment(movementIndex, momentIndex)}
                          aria-label={`Remove ${moment.title}`}
                          className="text-ink-3 hover:text-danger mt-0.5 shrink-0 rounded p-1 transition-colors"
                        >
                          ×
                        </button>
                      </div>
                    </li>
                  ))}
                </ol>
              </section>
            ))}
          </div>

          <ThemePicker value={themeId} onChange={setThemeId} />

          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex gap-2">
              <Button variant="ghost" size="sm" onClick={() => setStep("brief")}>
                <ArrowLeft className="size-3.5" aria-hidden />
                Change the brief
              </Button>
              <Button variant="secondary" size="sm" onClick={() => void buildMap()} loading={busy}>
                <RefreshCw className="size-3.5" aria-hidden />
                Try a different argument
              </Button>
            </div>
            <div className="flex items-center gap-3">
              <div>
                <Segmented
                  label="How much should be written"
                  size="sm"
                  value={depth}
                  onChange={setDepth}
                  options={[
                    { value: "full", label: "Write the content" },
                    { value: "outline", label: "Structure only" },
                  ]}
                />
                <p className="text-ink-3 mt-1 text-[10.5px] leading-snug">
                  {depth === "full"
                    ? "Complete scenes, ready to present."
                    : "Headings and cues; you write the words."}
                </p>
              </div>
              <Button variant="ai" size="lg" onClick={() => void generate()}>
                <Sparkles className="size-4" aria-hidden />
                Generate {momentCount} scenes
              </Button>
            </div>
          </div>

          <p className="text-ink-3 text-[11.5px] leading-relaxed">
            The map is saved with the presentation. You can keep editing it afterwards and
            regenerate any part of it without losing the rest.
          </p>
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
          <p className="text-ink mt-4 text-[15px] font-medium">
            Writing {momentCount} scenes from your map
          </p>
          <p className="text-ink-3 mt-1.5 max-w-sm text-[13px] leading-relaxed">
            Each scene is composed to do the job its moment describes, in the time it was given.
            This usually takes half a minute.
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
