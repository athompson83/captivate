"use client";

import { useCallback, useMemo, useState, useTransition } from "react";
import {
  DndContext,
  PointerSensor,
  KeyboardSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { AlertTriangle, Plus, Sparkles, Trash2 } from "lucide-react";
import { distributeSeconds, type EvidenceRef, type Moment } from "@/lib/schema/narrative";
import { assembleMap } from "@/lib/narrative/map";
import { formatDuration } from "@/lib/analysis/pacing";
import {
  addMoment,
  editMoment,
  relocateMoment,
  removeMoment,
  updatePresentationMeta,
  updateSectionLocal,
  useEditor,
} from "@/lib/editor/store";
import { insertSection, removeSection } from "@/lib/editor/store";
import { addSection } from "@/lib/data/actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Segmented } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/ui/dialog";
import { MomentCard } from "./moment-card";
import { cn } from "@/lib/utils/cn";

/**
 * The narrative map.
 *
 * The argument, before it is anything to look at. This is the contract scene
 * generation works from, which is why it is a first-class view rather than a
 * panel: the shape of what you are going to say is a bigger decision than any
 * individual scene, and it deserves the whole editor.
 *
 * Deliberately not a thumbnail sorter. Movements are typographic bands with a
 * stated job; moments are cards carrying the sentence that justifies them. What
 * you read scanning down the page is the argument itself.
 */
export function NarrativeMapView({
  presentationId,
  evidenceOptions,
  onGenerate,
  generating,
  className,
}: {
  presentationId: string;
  evidenceOptions: EvidenceRef[];
  onGenerate: (depth: "outline" | "full") => void;
  generating: boolean;
  className?: string;
}) {
  const { toast } = useToast();
  const sections = useEditor((s) => s.document.sections);
  const moments = useEditor((s) => s.document.moments);
  const scenes = useEditor((s) => s.document.scenes);
  const [pending, start] = useTransition();
  const [regenerating, setRegenerating] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<{ id: string; label: string; count: number } | null>(
    null,
  );

  const map = useMemo(() => assembleMap(sections, moments), [sections, moments]);
  const targetSeconds = useEditor((s) => s.document.presentation.targetSeconds);
  const derived = useEditor((s) => s.momentsDerived);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    // Keyboard reordering is not a fallback here: dnd-kit's keyboard sensor
    // moves an item with the arrow keys and announces each step, which is the
    // whole accessible reorder story in one mechanism rather than two.
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const ordinals = useMemo(() => {
    const out = new Map<string, number>();
    let n = 1;
    for (const movement of map.movements) {
      for (const moment of movement.moments) out.set(moment.id, n++);
    }
    return out;
  }, [map]);

  const movementOptions = useMemo(
    () => map.movements.map((movement) => ({ id: movement.id, label: movement.label })),
    [map],
  );

  const onDragEnd = useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;

      const moving = moments.find((moment) => moment.id === active.id);
      const target = moments.find((moment) => moment.id === over.id);
      if (!moving || !target) return;

      const siblings = moments
        .filter((moment) => moment.movementId === target.movementId)
        .sort((a, b) => a.position - b.position);
      const index = siblings.findIndex((moment) => moment.id === target.id);

      relocateMoment(moving.id, target.movementId, index < 0 ? siblings.length : index);
    },
    [moments],
  );

  const nudge = useCallback(
    (moment: Moment, direction: -1 | 1) => {
      const siblings = moments
        .filter((item) => item.movementId === moment.movementId)
        .sort((a, b) => a.position - b.position);
      const index = siblings.findIndex((item) => item.id === moment.id);
      relocateMoment(moment.id, moment.movementId, Math.max(0, index + direction));
    },
    [moments],
  );

  const createMoment = useCallback(
    (movementId: string | null) => {
      const siblings = moments.filter((moment) => moment.movementId === movementId);
      const now = new Date().toISOString();
      addMoment({
        id: crypto.randomUUID(),
        presentationId,
        movementId,
        title: "",
        role: "evidence",
        purpose: "",
        takeaway: "",
        estimatedSeconds: 60,
        evidence: [],
        visualIntent: "auto",
        instructions: "",
        locked: false,
        position: siblings.length,
        createdAt: now,
        updatedAt: now,
      });
    },
    [moments, presentationId],
  );

  const duplicate = useCallback((moment: Moment) => {
    const now = new Date().toISOString();
    addMoment({
      ...moment,
      id: crypto.randomUUID(),
      title: moment.title ? `${moment.title} (copy)` : "",
      locked: false,
      position: moment.position + 1,
      createdAt: now,
      updatedAt: now,
    });
  }, []);

  /**
   * Rewrites one moment's proposal without touching the rest of the map.
   *
   * Locked moments refuse, rather than silently doing nothing: an action that
   * appears to work and does not is worse than one that says why it cannot.
   */
  const regenerate = useCallback(
    async (moment: Moment) => {
      if (moment.locked) {
        toast({
          tone: "info",
          title: "This moment is locked",
          description: "Unlock it first if you want Captivate to rewrite it.",
        });
        return;
      }

      setRegenerating(moment.id);
      try {
        const response = await fetch("/api/ai/moment", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            title: moment.title,
            role: moment.role,
            purpose: moment.purpose,
            takeaway: moment.takeaway,
            movementPurpose: map.movements.find((m) => m.id === moment.movementId)?.purpose ?? "",
          }),
        });
        const body = await response.json();
        if (!response.ok) throw new Error(body?.error ?? "Couldn't rewrite that moment.");

        editMoment(moment.id, {
          title: body.title ?? moment.title,
          purpose: body.purpose ?? moment.purpose,
          takeaway: body.takeaway ?? moment.takeaway,
        });
        if (body.notice) toast({ tone: "info", title: "Rewritten", description: body.notice });
      } catch (error) {
        toast({
          tone: "error",
          title: "Couldn't rewrite that moment",
          description: error instanceof Error ? error.message : "Try again in a moment.",
        });
      } finally {
        setRegenerating(null);
      }
    },
    [map.movements, toast],
  );

  /**
   * Rescales the plan to the planned length.
   *
   * Time only, never wording: this changes how long each beat is given, not
   * what it says. Locked moments keep exactly the time the author gave them
   * and the remainder is redistributed across the rest in the proportions they
   * already had, so a deliberate two-minute opening stays two minutes.
   *
   * Offered, never automatic. A map that runs long is a fact about the
   * argument, and cutting it is the author's decision.
   */
  const fitToTarget = useCallback(() => {
    if (targetSeconds <= 0) return;

    const lockedSeconds = moments
      .filter((moment) => moment.locked)
      .reduce((sum, moment) => sum + moment.estimatedSeconds, 0);
    const unlocked = moments.filter((moment) => !moment.locked);
    const available = targetSeconds - lockedSeconds;

    if (unlocked.length === 0 || available <= 0) {
      toast({
        tone: "info",
        title: "Nothing left to rescale",
        description:
          unlocked.length === 0
            ? "Every moment is locked, so their durations are yours to change."
            : `Your locked moments already account for ${formatDuration(lockedSeconds)}. Unlock some, or plan a longer talk.`,
      });
      return;
    }

    // Equal shares where nothing has a duration yet, rather than dividing by
    // zero and giving the whole talk to the first beat.
    const weights = unlocked.map((moment) => moment.estimatedSeconds);
    const seconds = distributeSeconds(
      weights.some((weight) => weight > 0) ? weights : unlocked.map(() => 1),
      available,
    );

    unlocked.forEach((moment, index) => {
      if (moment.estimatedSeconds === seconds[index]) return;
      editMoment(moment.id, { estimatedSeconds: seconds[index] }, { label: "Fit to length" });
    });

    toast({
      tone: "success",
      title: `Rescaled to ${formatDuration(targetSeconds)}`,
      description: "Only the durations changed. Nothing you wrote was touched.",
    });
  }, [moments, targetSeconds, toast]);

  const createMovement = () => {
    start(async () => {
      const result = await addSection({ presentationId, title: "New movement" });
      if (!result.ok) {
        toast({ tone: "error", title: "Couldn't add a movement", description: result.error });
        return;
      }
      const now = new Date().toISOString();
      insertSection({
        id: result.data.id,
        presentationId,
        title: "New movement",
        label: "",
        purpose: "",
        position: sections.length,
        createdAt: now,
        updatedAt: now,
      });
    });
  };

  const scenesFor = (momentId: string) =>
    scenes.filter((scene) => scene.momentId === momentId).length;

  return (
    <section
      aria-label="Narrative map"
      className={cn("bg-sunken min-h-0 flex-1 overflow-y-auto", className)}
    >
      <div className="mx-auto max-w-4xl px-5 py-8 sm:px-8">
        <header className="mb-7">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h1
                className="text-ink text-[21px] font-semibold tracking-tight"
                style={{ fontFamily: "var(--font-display)" }}
              >
                Narrative map
              </h1>
              <p className="text-ink-3 mt-1 max-w-2xl text-[13px] leading-relaxed">
                What each part of the argument has to accomplish, decided before anything is
                rendered. Scenes are generated from this.
              </p>
            </div>

            {/* Wraps. The row outside this one already did, but the controls
                inside it did not, so at 390px the cluster stayed one 476px
                line and "Generate scenes" — the whole point of the map gate —
                was 86px past the right edge of a pane that cannot scroll
                sideways. */}
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <PlannedLength
                seconds={targetSeconds}
                onChange={(value) =>
                  updatePresentationMeta(
                    { targetSeconds: value },
                    { label: "Planned length", coalesceKey: "target-seconds" },
                  )
                }
              />
              <RunningTotal
                seconds={map.totalSeconds}
                moments={map.momentCount}
                targetSeconds={targetSeconds}
              />
              <GenerateControl onGenerate={onGenerate} generating={generating} />
            </div>
          </div>
        </header>

        {derived && moments.length > 0 && (
          <p
            role="status"
            className="text-ink-3 border-line-subtle mb-6 rounded-[var(--radius-md)] border border-dashed px-3.5 py-2.5 text-[12px] leading-relaxed"
          >
            This map was read back from the scenes this presentation already has, so the roles are
            guesses and nothing states its purpose yet. Edit anything here and it becomes yours.
          </p>
        )}

        <DurationWarning
          seconds={map.totalSeconds}
          targetSeconds={targetSeconds}
          onCompress={fitToTarget}
          busy={false}
        />

        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext
            items={moments.map((moment) => moment.id)}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-8">
              {map.movements.map((movement) => (
                <section key={movement.id ?? "unplaced"}>
                  <div className="mb-3 flex items-start gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <input
                          value={
                            movement.id
                              ? (sections.find((s) => s.id === movement.id)?.label ?? "")
                              : ""
                          }
                          onChange={(e) =>
                            movement.id &&
                            updateSectionLocal(movement.id, { label: e.target.value.slice(0, 24) })
                          }
                          placeholder={movement.title}
                          aria-label={`Short label for ${movement.title}`}
                          disabled={!movement.id}
                          className="border-accent/30 text-accent focus:border-accent w-[124px] rounded-full border bg-[var(--accent-soft)] px-2.5 py-0.5 text-[10.5px] font-medium tracking-[0.14em] uppercase outline-none disabled:opacity-60"
                        />
                        <span className="text-ink-3 text-[11px] tabular-nums">
                          {formatDuration(movement.estimatedSeconds)} · {movement.moments.length}{" "}
                          {movement.moments.length === 1 ? "moment" : "moments"}
                        </span>
                      </div>

                      <input
                        value={movement.title}
                        onChange={(e) =>
                          movement.id && updateSectionLocal(movement.id, { title: e.target.value })
                        }
                        aria-label="Movement title"
                        disabled={!movement.id}
                        className="text-ink hover:border-line-subtle focus:border-line mt-1.5 w-full rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1 py-0.5 text-[17px] font-semibold tracking-tight outline-none focus:bg-[var(--surface-inset)] disabled:opacity-70"
                      />

                      <textarea
                        value={movement.purpose}
                        onChange={(e) =>
                          movement.id &&
                          updateSectionLocal(
                            movement.id,
                            { purpose: e.target.value },
                            `movement-purpose-${movement.id}`,
                          )
                        }
                        rows={1}
                        placeholder="What this stretch of the argument accomplishes."
                        aria-label="Movement purpose"
                        disabled={!movement.id}
                        className="text-ink-3 hover:border-line-subtle focus:border-line mt-0.5 field-sizing-content w-full resize-none rounded-[var(--radius-sm)] border border-transparent bg-transparent px-1 py-0.5 text-[12.5px] leading-snug outline-none focus:bg-[var(--surface-inset)]"
                      />
                    </div>

                    {movement.id && (
                      <button
                        onClick={() =>
                          setDeleting({
                            id: movement.id!,
                            label: movement.label,
                            count: movement.moments.length,
                          })
                        }
                        aria-label={`Delete the ${movement.label} movement`}
                        className="text-ink-3 hover:text-danger mt-1 rounded p-1 transition-colors"
                      >
                        <Trash2 className="size-3.5" aria-hidden />
                      </button>
                    )}
                  </div>

                  <ol className="space-y-2">
                    {movement.moments.map((moment, index) => (
                      <MomentCard
                        key={moment.id}
                        moment={moment}
                        index={index}
                        ordinal={ordinals.get(moment.id) ?? index + 1}
                        movementCount={map.movements.length}
                        evidenceOptions={evidenceOptions}
                        movements={movementOptions}
                        regenerating={regenerating === moment.id}
                        onChange={(patch, options) =>
                          editMoment(moment.id, patch, {
                            coalesceKey: options?.coalesceKey,
                          })
                        }
                        onDelete={() => removeMoment(moment.id)}
                        onDuplicate={() => duplicate(moment)}
                        onRegenerate={() => void regenerate(moment)}
                        onMove={(direction) => nudge(moment, direction)}
                        onMoveToMovement={(movementId) =>
                          relocateMoment(moment.id, movementId, Number.MAX_SAFE_INTEGER)
                        }
                      />
                    ))}
                  </ol>

                  <button
                    onClick={() => createMoment(movement.id)}
                    className="border-line text-ink-3 hover:border-line-strong hover:text-ink mt-2 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed py-2 text-[12px] transition-colors"
                  >
                    <Plus className="size-3" aria-hidden />
                    Add a moment to {movement.label}
                  </button>
                </section>
              ))}
            </div>
          </SortableContext>
        </DndContext>

        <button
          onClick={createMovement}
          disabled={pending}
          className="border-line text-ink-3 hover:border-line-strong hover:text-ink mt-8 flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed py-2.5 text-[12.5px] transition-colors disabled:opacity-60"
        >
          <Plus className="size-3.5" aria-hidden />
          Add a movement
        </button>

        {scenes.length > 0 && (
          <p className="text-ink-3 mt-6 text-[11.5px] leading-relaxed">
            {moments.filter((moment) => scenesFor(moment.id) > 0).length} of {moments.length}{" "}
            moments have generated scenes. Generating again replaces the scenes for unlocked moments
            and leaves locked ones alone.
          </p>
        )}
      </div>

      <ConfirmDialog
        open={Boolean(deleting)}
        onClose={() => setDeleting(null)}
        onConfirm={() => {
          if (!deleting) return;
          // The moments survive: deleting a movement is a reorganisation, not a
          // decision to throw away part of the argument.
          for (const moment of moments.filter((m) => m.movementId === deleting.id)) {
            editMoment(moment.id, { movementId: null });
          }
          removeSection(deleting.id);
          setDeleting(null);
        }}
        title={`Delete the ${deleting?.label ?? ""} movement?`}
        description={
          deleting?.count
            ? `Its ${deleting.count} ${deleting.count === 1 ? "moment moves" : "moments move"} to Unplaced, where you can file them again. Nothing is lost.`
            : "This movement has no moments in it."
        }
        confirmLabel="Delete movement"
      />
    </section>
  );
}

/**
 * How long the talk is meant to run.
 *
 * Minutes, because nobody plans a lecture in seconds. Empty means no target,
 * which is a real answer rather than a value to be nagged about: a map with no
 * stated length is never warned about its length.
 */
function PlannedLength({
  seconds,
  onChange,
}: {
  seconds: number;
  onChange: (seconds: number) => void;
}) {
  return (
    <label className="text-ink-3 flex items-center gap-1.5 text-[11px]">
      <span>Planned</span>
      <input
        type="number"
        min={0}
        max={240}
        step={5}
        value={seconds > 0 ? Math.round(seconds / 60) : ""}
        onChange={(event) => {
          const minutes = Number(event.target.value);
          onChange(Number.isFinite(minutes) ? Math.min(240, Math.max(0, minutes)) * 60 : 0);
        }}
        placeholder="—"
        aria-label="Planned running time in minutes"
        className="border-line text-ink focus:border-accent w-[52px] rounded-[var(--radius-sm)] border bg-[var(--surface-inset)] px-1.5 py-1 text-center text-[12px] tabular-nums outline-none"
      />
      <span>min</span>
    </label>
  );
}

/**
 * The running total.
 *
 * Warns rather than blocks, and never silently changes anything. A map that
 * runs long is a fact about the argument, and the author is the one who
 * decides what to cut.
 */
function RunningTotal({
  seconds,
  moments,
  targetSeconds,
}: {
  seconds: number;
  moments: number;
  targetSeconds: number;
}) {
  const difference = seconds - targetSeconds;
  const material = targetSeconds > 0 && Math.abs(difference) > targetSeconds * TOLERANCE;

  return (
    <div className="text-right">
      <p
        className={cn(
          "text-[15px] font-semibold tabular-nums",
          material ? "text-[var(--warning)]" : "text-ink",
        )}
      >
        {formatDuration(seconds)}
      </p>
      <p className="text-ink-3 text-[11px]">
        {moments} {moments === 1 ? "moment" : "moments"} · estimated
      </p>
    </div>
  );
}

/**
 * How far off the plan can be before it is worth saying so.
 *
 * Estimates are estimates. Warning at every second over would make the warning
 * furniture, and furniture is ignored.
 */
const TOLERANCE = 0.15;

/** Shown when the map materially misses the length that was asked for. */
export function DurationWarning({
  seconds,
  targetSeconds,
  onCompress,
  busy,
}: {
  seconds: number;
  targetSeconds: number;
  onCompress: () => void;
  busy: boolean;
}) {
  const difference = seconds - targetSeconds;
  if (targetSeconds <= 0 || Math.abs(difference) <= targetSeconds * TOLERANCE) return null;

  const over = difference > 0;

  return (
    <div
      role="status"
      className="border-line mb-6 flex flex-wrap items-center gap-3 rounded-[var(--radius-lg)] border bg-[var(--warning-soft,var(--surface-inset))] px-3.5 py-3"
    >
      <AlertTriangle className="size-4 shrink-0 text-[var(--warning)]" aria-hidden />
      <p className="text-ink-2 min-w-0 flex-1 text-[12.5px] leading-snug">
        This map runs about {formatDuration(Math.abs(difference))} {over ? "longer" : "shorter"}{" "}
        than the {formatDuration(targetSeconds)} you planned for.{" "}
        {over
          ? "Nothing has been changed — you decide what comes out."
          : "There is room for more, if the argument needs it."}
      </p>
      <Button variant="secondary" size="xs" onClick={onCompress} loading={busy}>
        Rescale to {formatDuration(targetSeconds)}
      </Button>
    </div>
  );
}

/**
 * Generate, with the one decision that changes what generation means: whether
 * Captivate writes the talk or only its frame. The choice is remembered for
 * the session, not buried in a settings page.
 */
function GenerateControl({
  onGenerate,
  generating,
}: {
  onGenerate: (depth: "outline" | "full") => void;
  generating: boolean;
}) {
  const [depth, setDepth] = useState<"outline" | "full">("full");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Segmented
        label="How much should be written"
        size="sm"
        value={depth}
        onChange={setDepth}
        options={[
          { value: "full", label: "Full content" },
          { value: "outline", label: "Outline" },
        ]}
      />
      <Button variant="primary" size="sm" onClick={() => onGenerate(depth)} loading={generating}>
        <Sparkles className="size-3.5" aria-hidden />
        Generate scenes
      </Button>
    </div>
  );
}
