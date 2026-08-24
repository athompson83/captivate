"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  ChevronLeft,
  ChevronRight,
  Eraser,
  ExternalLink,
  Highlighter,
  LayoutGrid,
  Link2Off,
  Minus,
  MonitorPlay,
  Pen,
  Plus,
  Pointer,
  RotateCcw,
  Square,
  Telescope,
  Timer,
  X,
} from "lucide-react";
import type { PresentationRecord, Scene, Section } from "@/lib/schema/presentation";
import type { LectureNote } from "@/lib/data/notes";
import { getTheme } from "@/lib/schema/theme";
import { usePresentSession, plannedDuration } from "@/lib/present/session";
import { PRESENTER_COLORS, type PresenterTool, type RecordingStatus } from "@/lib/present/protocol";
import { Stage, StageThumbnail } from "@/components/stage/stage";
import { AnnotationLayer } from "./annotation-layer";
import { SceneJumper } from "./scene-jumper";
import { Tooltip } from "@/components/ui/misc";
import { cn } from "@/lib/utils/cn";
import { formatDuration } from "@/lib/utils/format";

/**
 * The presenter console.
 *
 * A separate route from the stage, opened in a second window. It is the only
 * place speaker notes, lecture notes, timers and the navigator exist — the
 * stage window has no code that renders any of them.
 *
 * The "control pad" is a scaled live view of the current scene. Drawing on it
 * sends normalised coordinates to the stage, so a presenter can point at and
 * annotate a projector image while looking at their own laptop.
 */
export function PresenterConsole({
  presentation,
  scenes,
  sections,
  lectureNotes,
}: {
  presentation: PresentationRecord;
  scenes: Scene[];
  sections: Section[];
  lectureNotes: LectureNote[];
}) {
  const theme = getTheme(presentation.themeId);
  const session = usePresentSession({
    presentationId: presentation.id,
    scenes,
    role: "console",
  });

  const [tool, setTool] = useState<PresenterTool>("none");
  const [color, setColor] = useState<string>(PRESENTER_COLORS[0].value);
  const [penWidth, setPenWidth] = useState(1);
  const [notesScale, setNotesScale] = useState(1);
  const [notesTab, setNotesTab] = useState<"speaker" | "lecture">("speaker");
  const [jumperOpen, setJumperOpen] = useState(false);
  const [recording, setRecording] = useState<{ status: RecordingStatus; elapsedMs: number } | null>(
    null,
  );
  const notesRef = useRef<HTMLDivElement>(null);

  /* Recording status arrives from the stage window. */
  useEffect(() => {
    const channel = session.channel;
    if (!channel) return;
    return channel.on((message) => {
      if (message.type === "recording") {
        setRecording({ status: message.status, elapsedMs: message.elapsedMs });
      }
    });
  }, [session.channel]);

  /* Scroll notes back to the top whenever the scene changes. */
  useEffect(() => {
    notesRef.current?.scrollTo({ top: 0 });
  }, [session.sceneIndex]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (
        e.target instanceof HTMLElement &&
        // BUTTON as well as the text fields: Space and Enter advance the
        // presentation, and they are also how a focused control is activated.
        // Without this, activating a hotspot from the keyboard dived into the
        // detail scene and advanced straight back out of it in one keystroke.
        (e.target.isContentEditable || ["INPUT", "TEXTAREA", "BUTTON"].includes(e.target.tagName))
      ) {
        return;
      }
      switch (e.key) {
        case "ArrowRight":
        case "PageDown":
        case " ":
          e.preventDefault();
          session.next();
          break;
        case "ArrowLeft":
        case "PageUp":
          e.preventDefault();
          session.prev();
          break;
        case "b":
        case "B":
          e.preventDefault();
          session.toggleBlank();
          break;
        // Deliberately not Tab. This listener is on `window`, so binding Tab
        // here cancelled it everywhere outside a text field — which is a
        // keyboard trap, and on the console it also meant every timer, tool
        // and note control could never be reached at all.
        case "o":
        case "O":
          e.preventDefault();
          session.toggleOverview();
          break;
        case "c":
        case "C":
          e.preventDefault();
          session.clearScene();
          break;
        case "l":
        case "L":
          e.preventDefault();
          setTool((t) => (t === "laser" ? "none" : "laser"));
          break;
        case "h":
        case "H":
          e.preventDefault();
          setTool((t) => (t === "highlight" ? "none" : "highlight"));
          break;
        case "d":
        case "D":
          e.preventDefault();
          setTool((t) => (t === "draw" ? "none" : "draw"));
          break;
        default:
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [session]);

  const planned = useMemo(() => plannedDuration(scenes), [scenes]);
  const sceneNotes = session.scene?.speakerNotes ?? "";
  const relevantNotes = lectureNotes.filter(
    (n) => n.sceneId === session.scene?.id || (!n.sceneId && !n.sectionId),
  );

  const sceneTarget = session.scene?.durationSeconds ?? null;
  const overTarget = sceneTarget !== null && session.sceneElapsedMs / 1000 > sceneTarget;
  const overPlan = planned !== null && session.totalElapsedMs / 1000 > planned;

  return (
    <div className="bg-sunken grid h-screen grid-rows-[auto_minmax(0,1fr)] overflow-hidden">
      <header className="border-line-subtle bg-base flex items-center gap-3 border-b px-4 py-2.5">
        <MonitorPlay className="text-accent size-4 shrink-0" aria-hidden />
        <span className="text-ink truncate text-[13px] font-medium">{presentation.title}</span>

        <ConnectionBadge connected={session.peerConnected} presentationId={presentation.id} />

        {recording && recording.status !== "idle" && (
          <span className="text-record flex items-center gap-1.5 rounded-full bg-[var(--record-soft)] px-2.5 py-1 text-[11px] font-medium">
            <span
              className="bg-record size-1.5 animate-[captivate-pulse_1.6s_ease-in-out_infinite] rounded-full"
              aria-hidden
            />
            {recording.status === "paused" ? "Paused" : "Recording"}{" "}
            {formatDuration(recording.elapsedMs / 1000)}
          </span>
        )}

        <div className="flex-1" />

        <Timers
          totalMs={session.totalElapsedMs}
          sceneMs={session.sceneElapsedMs}
          planned={planned}
          sceneTarget={sceneTarget}
          overTarget={overTarget}
          overPlan={overPlan}
          paused={session.paused}
          onTogglePause={session.togglePause}
          onReset={session.resetTimer}
        />

        <Link
          href={`/edit/${presentation.id}`}
          aria-label="Close presenter console"
          className="text-ink-3 hover:text-ink rounded p-1.5 transition-colors hover:bg-[var(--surface-inset)]"
        >
          <X className="size-4" aria-hidden />
        </Link>
      </header>

      <div className="grid min-h-0 grid-cols-1 gap-3 p-3 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        {/* Left: the control pad and the next-scene preview. */}
        <div className="flex min-h-0 flex-col gap-3">
          <section aria-label="Current scene" className="shrink-0">
            <div className="border-line relative aspect-video w-full overflow-hidden rounded-[var(--radius-lg)] border bg-black">
              {session.scene && (
                <Stage
                  content={session.scene.content}
                  theme={theme}
                  aspect={presentation.aspectRatio}
                  play={false}
                  step={session.step}
                  className="size-full"
                />
              )}

              {/* Drawing here maps 1:1 onto the audience display. */}
              <AnnotationLayer
                annotations={session.annotations}
                tool={tool}
                color={color}
                width={penWidth}
                interactive
                onChange={(next) => session.setAnnotations(session.sceneIndex, next)}
                onPointer={(point) => session.broadcastPointer(point, "laser", color)}
                pointer={session.pointer}
                pointerColor={color}
              />

              {session.blanked && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/92">
                  <span className="rounded-full border border-white/20 px-3 py-1.5 text-[12px] text-white/70">
                    Screen blanked — press B to restore
                  </span>
                </div>
              )}

              <span className="pointer-events-none absolute top-2.5 left-2.5 rounded-full bg-black/60 px-2 py-0.5 text-[11px] text-white/85 tabular-nums">
                {session.sceneIndex + 1} / {scenes.length}
                {session.stepsInScene > 1 && ` · build ${session.step + 1}/${session.stepsInScene}`}
              </span>
            </div>

            <ToolBar
              tool={tool}
              onToolChange={setTool}
              color={color}
              onColorChange={setColor}
              penWidth={penWidth}
              onPenWidthChange={setPenWidth}
              hasAnnotations={
                session.annotations.strokes.length > 0 || session.annotations.highlights.length > 0
              }
              onClearScene={session.clearScene}
              onClearAll={session.clearAll}
              blanked={session.blanked}
              onToggleBlank={session.toggleBlank}
              overview={session.overview}
              onToggleOverview={session.toggleOverview}
              onOpenJumper={() => setJumperOpen(true)}
            />
          </section>

          <SceneFilmstrip
            scenes={scenes}
            sections={sections}
            theme={theme}
            aspect={presentation.aspectRatio}
            currentIndex={session.sceneIndex}
            onSelect={session.goto}
          />

          <section aria-label="Navigation" className="flex shrink-0 items-center gap-3">
            <button
              onClick={session.prev}
              disabled={session.sceneIndex === 0 && session.step === 0}
              className="border-line text-ink-2 hover:border-line-strong hover:text-ink flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] border transition-colors disabled:pointer-events-none disabled:opacity-30"
              aria-label="Previous"
            >
              <ChevronLeft className="size-5" aria-hidden />
            </button>

            <div className="min-w-0 flex-1">
              <p className="text-ink-3 mb-1 text-[10px] font-medium tracking-wider uppercase">
                Next
              </p>
              {session.nextScene ? (
                <button
                  onClick={session.next}
                  className="border-line-subtle bg-base hover:border-line flex w-full items-center gap-2.5 rounded-[var(--radius-md)] border p-1.5 text-left transition-colors"
                >
                  <span className="border-line-subtle shrink-0 overflow-hidden rounded-[3px] border">
                    <StageThumbnail
                      content={session.nextScene.content}
                      theme={theme}
                      aspect={presentation.aspectRatio}
                      width={104}
                    />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="text-ink block truncate text-[12.5px]">
                      {session.nextScene.title || `Scene ${session.sceneIndex + 2}`}
                    </span>
                    <span className="text-ink-3 block truncate text-[11px]">
                      {sections.find((s) => s.id === session.nextScene?.sectionId)?.title ??
                        "Up next"}
                    </span>
                  </span>
                </button>
              ) : (
                <p className="border-line text-ink-3 rounded-[var(--radius-md)] border border-dashed px-3 py-3 text-[12px]">
                  Last scene — you&apos;re at the end.
                </p>
              )}
            </div>

            <button
              onClick={session.next}
              disabled={
                session.sceneIndex === scenes.length - 1 &&
                session.step === session.stepsInScene - 1
              }
              className="bg-accent flex size-11 shrink-0 items-center justify-center rounded-[var(--radius-md)] text-[var(--accent-contrast)] transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-30"
              aria-label="Next"
            >
              <ChevronRight className="size-5" aria-hidden />
            </button>
          </section>
        </div>

        {/* Right: private notes. */}
        <section
          aria-label="Presenter notes"
          className="border-line-subtle bg-base flex min-h-0 flex-col rounded-[var(--radius-lg)] border"
        >
          <div className="border-line-subtle flex shrink-0 items-center gap-2 border-b px-3 py-2">
            <div className="flex gap-0.5">
              {(["speaker", "lecture"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setNotesTab(t)}
                  aria-pressed={notesTab === t}
                  className={cn(
                    "rounded-[var(--radius-sm)] px-2.5 py-1 text-[12px] font-medium transition-colors",
                    notesTab === t
                      ? "text-ink bg-[var(--surface-inset)]"
                      : "text-ink-3 hover:text-ink-2",
                  )}
                >
                  {t === "speaker"
                    ? "Speaker notes"
                    : `Lecture notes${relevantNotes.length ? ` (${relevantNotes.length})` : ""}`}
                </button>
              ))}
            </div>

            <div className="flex-1" />

            <div className="flex items-center gap-0.5" role="group" aria-label="Note text size">
              <button
                onClick={() => setNotesScale((s) => Math.max(0.8, s - 0.1))}
                aria-label="Smaller notes text"
                className="text-ink-3 hover:text-ink rounded p-1 transition-colors hover:bg-[var(--surface-inset)]"
              >
                <Minus className="size-3" aria-hidden />
              </button>
              <span className="text-ink-3 w-8 text-center text-[10.5px] tabular-nums">
                {Math.round(notesScale * 100)}%
              </span>
              <button
                onClick={() => setNotesScale((s) => Math.min(2.2, s + 0.1))}
                aria-label="Larger notes text"
                className="text-ink-3 hover:text-ink rounded p-1 transition-colors hover:bg-[var(--surface-inset)]"
              >
                <Plus className="size-3" aria-hidden />
              </button>
            </div>
          </div>

          <div ref={notesRef} className="min-h-0 flex-1 overflow-y-auto p-4">
            {notesTab === "speaker" ? (
              sceneNotes.trim() ? (
                <p
                  className="text-ink leading-relaxed whitespace-pre-wrap"
                  style={{ fontSize: `${15 * notesScale}px`, lineHeight: 1.65 }}
                >
                  {sceneNotes}
                </p>
              ) : (
                <p className="text-ink-3 text-[13px] leading-relaxed">
                  No speaker notes for this scene. Add them in the editor — they never appear on the
                  audience display.
                </p>
              )
            ) : relevantNotes.length ? (
              <div className="space-y-5">
                {relevantNotes.map((note) => (
                  <article key={note.id}>
                    <h3 className="text-ink-3 mb-1.5 text-[12px] font-semibold tracking-wider uppercase">
                      {note.title}
                      {note.sceneId === session.scene?.id && (
                        <span className="text-accent-text ml-2 rounded-full bg-[var(--accent-soft)] px-1.5 py-0.5 text-[10px] tracking-normal normal-case">
                          this scene
                        </span>
                      )}
                    </h3>
                    <p
                      className="text-ink-2 leading-relaxed whitespace-pre-wrap"
                      style={{ fontSize: `${14 * notesScale}px`, lineHeight: 1.65 }}
                    >
                      {note.body}
                    </p>
                  </article>
                ))}
              </div>
            ) : (
              <p className="text-ink-3 text-[13px] leading-relaxed">
                No lecture notes attached to this scene or to the presentation as a whole.
              </p>
            )}
          </div>
        </section>
      </div>

      <SceneJumper
        open={jumperOpen}
        onClose={() => setJumperOpen(false)}
        scenes={scenes}
        sections={sections}
        currentIndex={session.sceneIndex}
        onSelect={(index) => {
          session.goto(index);
          setJumperOpen(false);
        }}
        title={presentation.title}
        themeId={presentation.themeId}
      />
    </div>
  );
}

/* -------------------------------------------------------------------------- */

/**
 * Horizontal strip of every scene.
 *
 * This is the answer to the two questions a presenter actually has mid-talk:
 * where am I, and what is coming. It also makes "can you go back to the slide
 * with the algorithm" a single click rather than a scrub through the deck.
 */
function SceneFilmstrip({
  scenes,
  sections,
  theme,
  aspect,
  currentIndex,
  onSelect,
}: {
  scenes: Scene[];
  sections: Section[];
  theme: ReturnType<typeof getTheme>;
  aspect: PresentationRecord["aspectRatio"];
  currentIndex: number;
  onSelect: (index: number) => void;
}) {
  const stripRef = useRef<HTMLDivElement>(null);

  // Keep the active scene in view as the presentation advances.
  useEffect(() => {
    const active = stripRef.current?.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [currentIndex]);

  if (scenes.length < 2) return null;

  return (
    <section
      aria-label="All scenes"
      className="border-line-subtle bg-base min-h-0 flex-1 overflow-hidden rounded-[var(--radius-lg)] border"
    >
      <div ref={stripRef} className="no-scrollbar h-full overflow-x-auto overflow-y-hidden p-2">
        <ol className="flex h-full items-start gap-2">
          {/*
            The running order, and its own numbering. The jumper on the same
            console already filters asides out, with a comment saying why —
            listing them offers the presenter a destination they can only leave
            by going somewhere else. Both controls now answer the same way.
          */}
          {scenes
            .map((scene, index) => ({ scene, index }))
            .filter(({ scene }) => scene.flowRole !== "detail")
            .map(({ scene, index }, ordinal) => {
              const section = sections.find((s) => s.id === scene.sectionId);
              const active = index === currentIndex;
              return (
                <li key={scene.id} className="shrink-0">
                  <button
                    data-active={active}
                    onClick={() => onSelect(index)}
                    aria-current={active ? "true" : undefined}
                    aria-label={`Go to scene ${ordinal + 1}${scene.title ? `: ${scene.title}` : ""}`}
                    className={cn(
                      "block overflow-hidden rounded-[var(--radius-md)] border-2 text-left transition-colors",
                      active
                        ? "border-accent"
                        : index < currentIndex
                          ? "border-line-subtle opacity-55 hover:opacity-90"
                          : "border-line-subtle hover:border-line-strong",
                    )}
                  >
                    <StageThumbnail
                      content={scene.content}
                      theme={theme}
                      aspect={aspect}
                      width={132}
                    />
                    <span className="flex items-baseline gap-1.5 px-1.5 py-1">
                      <span
                        className={cn(
                          "text-[10px] tabular-nums",
                          active ? "text-accent-text" : "text-ink-3",
                        )}
                      >
                        {ordinal + 1}
                      </span>
                      <span className="text-ink-2 max-w-[104px] truncate text-[10.5px]">
                        {scene.title || section?.title || "Untitled"}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
        </ol>
      </div>
    </section>
  );
}

function ConnectionBadge({
  connected,
  presentationId,
}: {
  connected: boolean;
  presentationId: string;
}) {
  if (connected) {
    return (
      <span className="text-success flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-[11px] font-medium">
        <span className="bg-success size-1.5 rounded-full" aria-hidden />
        Stage connected
      </span>
    );
  }

  return (
    <a
      href={`/present/${presentationId}?audience=1`}
      target="_blank"
      rel="noreferrer"
      className="text-accent-text flex shrink-0 items-center gap-1.5 rounded-full bg-[var(--accent-soft)] px-2 py-0.5 text-[11px] font-medium transition-opacity hover:opacity-85"
    >
      <Link2Off className="size-3" aria-hidden />
      No stage — open the audience window
      <ExternalLink className="size-2.5" aria-hidden />
    </a>
  );
}

function Timers({
  totalMs,
  sceneMs,
  planned,
  sceneTarget,
  overTarget,
  overPlan,
  paused,
  onTogglePause,
  onReset,
}: {
  totalMs: number;
  sceneMs: number;
  planned: number | null;
  sceneTarget: number | null;
  overTarget: boolean;
  overPlan: boolean;
  paused: boolean;
  onTogglePause: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex shrink-0 items-center gap-3">
      <div className="text-right">
        <p className="text-ink-3 text-[9.5px] font-medium tracking-wider uppercase">Scene</p>
        <p
          className={cn(
            "text-[15px] leading-tight font-semibold tabular-nums",
            overTarget ? "text-warning" : "text-ink",
          )}
        >
          {formatDuration(sceneMs / 1000)}
          {sceneTarget !== null && (
            <span className="text-ink-3 ml-1 text-[10px] font-normal">
              / {formatDuration(sceneTarget)}
            </span>
          )}
        </p>
      </div>

      <span aria-hidden className="bg-line-subtle h-7 w-px" />

      <div className="text-right">
        <p className="text-ink-3 text-[9.5px] font-medium tracking-wider uppercase">Total</p>
        <p
          className={cn(
            "text-[15px] leading-tight font-semibold tabular-nums",
            overPlan ? "text-warning" : "text-ink",
          )}
        >
          {formatDuration(totalMs / 1000)}
          {planned !== null && (
            <span className="text-ink-3 ml-1 text-[10px] font-normal">
              / {formatDuration(planned)}
            </span>
          )}
        </p>
      </div>

      <div className="flex items-center gap-0.5">
        <Tooltip label={paused ? "Resume timers" : "Pause timers"} side="bottom">
          <button
            onClick={onTogglePause}
            aria-label={paused ? "Resume timers" : "Pause timers"}
            aria-pressed={paused}
            className={cn(
              "flex size-7 items-center justify-center rounded-[var(--radius-sm)] transition-colors",
              paused
                ? "text-accent-text bg-[var(--accent-soft)]"
                : "text-ink-3 hover:text-ink hover:bg-[var(--surface-inset)]",
            )}
          >
            <Timer className="size-3.5" aria-hidden />
          </button>
        </Tooltip>
        <Tooltip label="Reset timers" side="bottom">
          <button
            onClick={onReset}
            aria-label="Reset timers"
            className="text-ink-3 hover:text-ink flex size-7 items-center justify-center rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--surface-inset)]"
          >
            <RotateCcw className="size-3.5" aria-hidden />
          </button>
        </Tooltip>
      </div>
    </div>
  );
}

function ToolBar({
  tool,
  onToolChange,
  color,
  onColorChange,
  penWidth,
  onPenWidthChange,
  hasAnnotations,
  onClearScene,
  onClearAll,
  blanked,
  onToggleBlank,
  overview,
  onToggleOverview,
  onOpenJumper,
}: {
  tool: PresenterTool;
  onToolChange: (t: PresenterTool) => void;
  color: string;
  onColorChange: (c: string) => void;
  penWidth: number;
  onPenWidthChange: (w: number) => void;
  hasAnnotations: boolean;
  onClearScene: () => void;
  onClearAll: () => void;
  blanked: boolean;
  onToggleBlank: () => void;
  overview: boolean;
  onToggleOverview: () => void;
  onOpenJumper: () => void;
}) {
  const TOOLS = [
    { tool: "laser" as const, icon: Pointer, label: "Laser pointer", key: "L" },
    { tool: "highlight" as const, icon: Highlighter, label: "Highlight", key: "H" },
    { tool: "draw" as const, icon: Pen, label: "Draw", key: "D" },
    { tool: "erase" as const, icon: Eraser, label: "Erase", key: "E" },
  ];

  return (
    <div
      role="toolbar"
      aria-label="Presenter tools"
      className="border-line-subtle bg-base mt-2 flex flex-wrap items-center gap-1 rounded-[var(--radius-md)] border px-1.5 py-1.5"
    >
      {TOOLS.map(({ tool: t, icon: Icon, label, key }) => (
        <Tooltip key={t} label={label} shortcut={key} side="top">
          <button
            onClick={() => onToolChange(tool === t ? "none" : t)}
            aria-label={label}
            aria-pressed={tool === t}
            className={cn(
              "flex size-8 items-center justify-center rounded-[var(--radius-sm)] transition-colors",
              tool === t
                ? "bg-accent text-[var(--accent-contrast)]"
                : "text-ink-3 hover:text-ink hover:bg-[var(--surface-inset)]",
            )}
          >
            <Icon className="size-4" aria-hidden />
          </button>
        </Tooltip>
      ))}

      {tool !== "none" && tool !== "erase" && (
        <>
          <span aria-hidden className="bg-line-subtle mx-1 h-4 w-px" />
          <div className="flex items-center gap-1" role="group" aria-label="Annotation colour">
            {PRESENTER_COLORS.map((c) => (
              <button
                key={c.id}
                onClick={() => onColorChange(c.value)}
                aria-label={c.label}
                aria-pressed={color === c.value}
                className={cn(
                  "size-4 rounded-full border-2 transition-transform hover:scale-110",
                  color === c.value ? "border-ink" : "border-line",
                )}
                style={{ background: c.value }}
              />
            ))}
          </div>
          {tool === "draw" && (
            <div className="flex items-center gap-0.5" role="group" aria-label="Pen thickness">
              {[0.6, 1, 1.8].map((w, i) => (
                <button
                  key={w}
                  onClick={() => onPenWidthChange(w)}
                  aria-label={["Thin", "Medium", "Thick"][i]}
                  aria-pressed={penWidth === w}
                  className={cn(
                    "flex size-6 items-center justify-center rounded-full transition-colors",
                    penWidth === w
                      ? "bg-[var(--surface-inset)]"
                      : "hover:bg-[var(--surface-inset)]",
                  )}
                >
                  <span
                    className="bg-ink-2 rounded-full"
                    style={{ width: 3 + i * 2.5, height: 3 + i * 2.5 }}
                  />
                </button>
              ))}
            </div>
          )}
        </>
      )}

      <div className="flex-1" />

      {hasAnnotations && (
        <>
          <button
            onClick={onClearScene}
            className="text-ink-3 hover:text-ink rounded-[var(--radius-sm)] px-2 py-1 text-[11.5px] transition-colors hover:bg-[var(--surface-inset)]"
          >
            Clear scene
          </button>
          <button
            onClick={onClearAll}
            className="text-ink-3 hover:text-ink rounded-[var(--radius-sm)] px-2 py-1 text-[11.5px] transition-colors hover:bg-[var(--surface-inset)]"
          >
            Clear all
          </button>
        </>
      )}

      <Tooltip label="Black out the audience screen" shortcut="B" side="top">
        <button
          onClick={onToggleBlank}
          aria-label="Black out the audience screen"
          aria-pressed={blanked}
          className={cn(
            "flex size-8 items-center justify-center rounded-[var(--radius-sm)] transition-colors",
            blanked
              ? "bg-ink text-ink-inverse"
              : "text-ink-3 hover:text-ink hover:bg-[var(--surface-inset)]",
          )}
        >
          <Square className="size-4" aria-hidden />
        </button>
      </Tooltip>

      <Tooltip label="See the whole journey" side="top">
        <button
          onClick={onToggleOverview}
          aria-label="See the whole journey"
          aria-pressed={overview}
          className={cn(
            "flex size-8 items-center justify-center rounded-[var(--radius-sm)] transition-colors",
            overview
              ? "bg-ink text-ink-inverse"
              : "text-ink-3 hover:text-ink hover:bg-[var(--surface-inset)]",
          )}
        >
          <Telescope className="size-4" aria-hidden />
        </button>
      </Tooltip>

      <Tooltip label="All scenes" side="top">
        <button
          onClick={onOpenJumper}
          aria-label="All scenes"
          className="text-ink-3 hover:text-ink flex size-8 items-center justify-center rounded-[var(--radius-sm)] transition-colors hover:bg-[var(--surface-inset)]"
        >
          <LayoutGrid className="size-4" aria-hidden />
        </button>
      </Tooltip>
    </div>
  );
}
