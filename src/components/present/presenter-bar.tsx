"use client";

import Link from "next/link";
import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import {
  Camera,
  ChevronLeft,
  ChevronRight,
  Eraser,
  Highlighter,
  LayoutGrid,
  Maximize2,
  Minimize2,
  MonitorPlay,
  Pen,
  Pointer,
  ScanFace,
  Square,
  Telescope,
  X,
} from "lucide-react";
import type { Scene, Section } from "@/lib/schema/presentation";
import type { CameraFeedSettings } from "./presenter-camera";
import type { PresentSession } from "@/lib/present/session";
import { PRESENTER_COLORS, type PresenterTool } from "@/lib/present/protocol";
import { Tooltip } from "@/components/ui/misc";
import { cn } from "@/lib/utils/cn";
import { formatDuration } from "@/lib/utils/format";
import { SceneJumper } from "./scene-jumper";

/**
 * Presenter controls on the stage window.
 *
 * Auto-hides after a few seconds of stillness so the audience sees content, not
 * chrome. Everything here is reachable by keyboard without ever showing the bar.
 */
export function PresenterBar({
  visible,
  presentationId,
  presentationTitle,
  session,
  sections,
  scenes,
  tool,
  onToolChange,
  color,
  onColorChange,
  penWidth,
  onPenWidthChange,
  cameraFeed,
  onCameraFeedChange,
  fullscreen,
  remote,
}: {
  visible: boolean;
  presentationId: string;
  presentationTitle: string;
  session: PresentSession;
  sections: Section[];
  scenes: Scene[];
  tool: PresenterTool;
  onToolChange: (t: PresenterTool) => void;
  color: string;
  onColorChange: (c: string) => void;
  penWidth: number;
  onPenWidthChange: (w: number) => void;
  cameraFeed: CameraFeedSettings;
  onCameraFeedChange: (next: CameraFeedSettings) => void;
  fullscreen: {
    active: boolean;
    supported: boolean;
    denied: boolean;
    toggle: () => Promise<boolean>;
  };
  /** The phone-remote control, or null where pairing is not offered. */
  remote: React.ReactNode;
}) {
  const [jumperOpen, setJumperOpen] = useState(false);

  const TOOLS: { tool: PresenterTool; icon: typeof Pointer; label: string; key: string }[] = [
    { tool: "laser", icon: Pointer, label: "Laser pointer", key: "L" },
    { tool: "highlight", icon: Highlighter, label: "Highlight an area", key: "H" },
    { tool: "draw", icon: Pen, label: "Draw", key: "D" },
    { tool: "erase", icon: Eraser, label: "Erase", key: "E" },
  ];

  const hasAnnotations =
    session.annotations.strokes.length > 0 || session.annotations.highlights.length > 0;

  return (
    <>
      <AnimatePresence>
        {visible && (
          <motion.div
            initial={{ opacity: 0, y: 14 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
            role="toolbar"
            aria-label="Presenter controls"
            onClick={(e) => e.stopPropagation()}
            className="absolute bottom-5 left-1/2 z-30 flex -translate-x-1/2 items-center gap-1 rounded-full border border-white/12 bg-black/72 px-2 py-1.5 text-white shadow-[0_16px_48px_rgba(0,0,0,0.55)] backdrop-blur-md"
          >
            <BarButton
              label="Previous"
              shortcut="←"
              onClick={session.prev}
              disabled={session.sceneIndex === 0 && session.step === 0}
            >
              <ChevronLeft className="size-4" aria-hidden />
            </BarButton>

            <button
              onClick={() => setJumperOpen(true)}
              className="rounded-full px-2.5 py-1 text-[12px] text-white/85 tabular-nums transition-colors hover:bg-white/10"
              aria-label="Jump to a scene"
            >
              {session.sceneIndex + 1} / {scenes.length}
            </button>

            <BarButton
              label="Next"
              shortcut="→"
              onClick={session.next}
              disabled={
                session.sceneIndex === scenes.length - 1 &&
                session.step === session.stepsInScene - 1
              }
            >
              <ChevronRight className="size-4" aria-hidden />
            </BarButton>

            <Divider />

            {TOOLS.map(({ tool: t, icon: Icon, label, key }) => (
              <BarButton
                key={t}
                label={label}
                shortcut={key}
                active={tool === t}
                onClick={() => onToolChange(tool === t ? "none" : t)}
              >
                <Icon className="size-4" aria-hidden />
              </BarButton>
            ))}

            {(tool === "draw" || tool === "highlight" || tool === "laser") && (
              <>
                <Divider />
                <div
                  className="flex items-center gap-1 px-1"
                  role="group"
                  aria-label="Annotation colour"
                >
                  {PRESENTER_COLORS.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => onColorChange(c.value)}
                      aria-label={c.label}
                      aria-pressed={color === c.value}
                      className={cn(
                        "size-4 rounded-full border-2 transition-transform hover:scale-110",
                        color === c.value ? "border-white" : "border-white/25",
                      )}
                      style={{ background: c.value }}
                    />
                  ))}
                </div>
                {tool === "draw" && (
                  <div
                    className="flex items-center gap-0.5"
                    role="group"
                    aria-label="Pen thickness"
                  >
                    {[0.6, 1, 1.8].map((w, i) => (
                      <button
                        key={w}
                        onClick={() => onPenWidthChange(w)}
                        aria-label={["Thin", "Medium", "Thick"][i]}
                        aria-pressed={penWidth === w}
                        className={cn(
                          "flex size-6 items-center justify-center rounded-full transition-colors",
                          penWidth === w ? "bg-white/20" : "hover:bg-white/10",
                        )}
                      >
                        <span
                          className="rounded-full bg-white"
                          style={{ width: 3 + i * 2.5, height: 3 + i * 2.5 }}
                        />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            {hasAnnotations && (
              <BarButton
                label="Clear markup on this scene"
                shortcut="C"
                onClick={session.clearScene}
              >
                <X className="size-4" aria-hidden />
              </BarButton>
            )}

            <Divider />

            <BarButton
              label="Black out the screen"
              shortcut="B"
              active={session.blanked}
              onClick={session.toggleBlank}
            >
              <Square className="size-4" aria-hidden />
            </BarButton>

            <BarButton
              label="See the whole journey"
              shortcut="O"
              active={session.overview}
              onClick={session.toggleOverview}
            >
              <Telescope className="size-4" aria-hidden />
            </BarButton>

            <BarButton
              label={cameraFeed.enabled ? "Hide my camera" : "Show my camera on stage"}
              shortcut="V"
              active={cameraFeed.enabled}
              onClick={() => onCameraFeedChange({ ...cameraFeed, enabled: !cameraFeed.enabled })}
            >
              <Camera className="size-4" aria-hidden />
            </BarButton>

            {cameraFeed.enabled && (
              <BarButton
                label={
                  cameraFeed.background === "remove"
                    ? "Background removed — click for blurred"
                    : cameraFeed.background === "blur"
                      ? "Background blurred — click to show it"
                      : "Background shown — click to remove it"
                }
                active={cameraFeed.background !== "none"}
                onClick={() => {
                  const background =
                    cameraFeed.background === "remove"
                      ? "blur"
                      : cameraFeed.background === "blur"
                        ? "none"
                        : "remove";
                  onCameraFeedChange({
                    ...cameraFeed,
                    background,
                    // A cut-out only exists when the background is removed;
                    // anything else needs a frame to live in.
                    shape: background === "remove" ? "cutout" : "rounded",
                  });
                }}
              >
                <ScanFace className="size-4" aria-hidden />
              </BarButton>
            )}

            <BarButton label="All scenes" onClick={() => setJumperOpen(true)}>
              <LayoutGrid className="size-4" aria-hidden />
            </BarButton>

            <Tooltip
              label={
                session.peerConnected ? "Presenter console is connected" : "Open presenter console"
              }
              side="top"
            >
              <a
                href={`/present/${presentationId}/console`}
                target="_blank"
                rel="noreferrer"
                aria-label="Open presenter console in a new window"
                className={cn(
                  "flex size-8 items-center justify-center rounded-full transition-colors",
                  session.peerConnected
                    ? "bg-[var(--success)]/20 text-[var(--success)]"
                    : "text-white/80 hover:bg-white/10",
                )}
              >
                <MonitorPlay className="size-4" aria-hidden />
              </a>
            </Tooltip>

            {remote}

            {fullscreen.supported && (
              <BarButton
                label={fullscreen.active ? "Leave full screen" : "Full screen"}
                shortcut="F"
                onClick={() => void fullscreen.toggle()}
              >
                {fullscreen.active ? (
                  <Minimize2 className="size-4" aria-hidden />
                ) : (
                  <Maximize2 className="size-4" aria-hidden />
                )}
              </BarButton>
            )}

            <Divider />

            <Tooltip label="Exit presentation" side="top">
              <Link
                href={`/edit/${presentationId}`}
                aria-label="Exit presentation"
                className="flex size-8 items-center justify-center rounded-full text-white/70 transition-colors hover:bg-white/10 hover:text-white"
              >
                <X className="size-4" aria-hidden />
              </Link>
            </Tooltip>

            <span className="mr-1.5 ml-1 text-[11px] text-white/50 tabular-nums">
              {formatDuration(session.totalElapsedMs / 1000)}
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      {fullscreen.denied && visible && (
        <div
          role="status"
          onClick={(e) => e.stopPropagation()}
          className="absolute top-5 left-1/2 z-30 -translate-x-1/2 rounded-full border border-white/12 bg-black/75 px-3.5 py-1.5 text-[12px] text-white/85 backdrop-blur-md"
        >
          This browser wouldn&apos;t go full screen. The stage still fills the window — hide your
          browser toolbars for a clean projection.
        </div>
      )}

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
        title={presentationTitle}
      />
    </>
  );
}

function BarButton({
  label,
  shortcut,
  onClick,
  active,
  disabled,
  children,
}: {
  label: string;
  shortcut?: string;
  onClick: () => void;
  active?: boolean;
  disabled?: boolean;
  children: React.ReactNode;
}) {
  return (
    <Tooltip label={label} shortcut={shortcut} side="top">
      <button
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "flex size-8 items-center justify-center rounded-full transition-colors",
          active ? "bg-white text-black" : "text-white/80 hover:bg-white/10 hover:text-white",
          "disabled:pointer-events-none disabled:opacity-30",
        )}
      >
        {children}
      </button>
    </Tooltip>
  );
}

const Divider = () => <span aria-hidden className="mx-0.5 h-4 w-px bg-white/15" />;
