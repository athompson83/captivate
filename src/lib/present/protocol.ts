import { z } from "zod";

/**
 * Cross-window presentation protocol.
 *
 * Carried over BroadcastChannel, which is same-origin only — no server, no
 * network, and no way for another site to join the channel. Messages are
 * validated on receipt anyway: a malformed message from a stale tab running an
 * older build must not be able to corrupt a live presentation.
 *
 * Roles:
 *   stage   — what the audience sees. Authoritative for scene and step.
 *   console — the presenter's private window. Sends commands, never state.
 *
 * Note what is *not* in this protocol: speaker notes, lecture notes, timers and
 * the scene navigator never cross to the stage. The stage window has no code
 * path that renders them, which is what keeps presenter-only material off the
 * projector even if a message were malformed.
 */

export const NormalisedPoint = z.object({
  x: z.number().min(-0.2).max(1.2),
  y: z.number().min(-0.2).max(1.2),
});
export type NormalisedPoint = z.infer<typeof NormalisedPoint>;

export const Stroke = z.object({
  id: z.string().max(64),
  color: z.string().max(32),
  width: z.number().min(0.1).max(4),
  points: z.array(NormalisedPoint).max(4000),
});
export type Stroke = z.infer<typeof Stroke>;

export const Highlight = z.object({
  id: z.string().max(64),
  x: z.number(),
  y: z.number(),
  w: z.number(),
  h: z.number(),
});
export type Highlight = z.infer<typeof Highlight>;

export const SceneAnnotations = z.object({
  strokes: z.array(Stroke).max(400),
  highlights: z.array(Highlight).max(40),
});
export type SceneAnnotations = z.infer<typeof SceneAnnotations>;

export const PresenterTool = z.enum(["none", "laser", "highlight", "draw", "erase"]);
export type PresenterTool = z.infer<typeof PresenterTool>;

export const PRESENTER_COLORS = [
  { id: "signal", label: "Amber", value: "#F0B858" },
  { id: "crimson", label: "Red", value: "#E2604F" },
  { id: "mint", label: "Green", value: "#3FBF87" },
  { id: "sky", label: "Blue", value: "#5AA9E6" },
  { id: "chalk", label: "White", value: "#FFFFFF" },
] as const;

export const RecordingStatus = z.enum([
  "idle",
  "starting",
  "recording",
  "paused",
  "stopping",
  "saving",
  "error",
]);
export type RecordingStatus = z.infer<typeof RecordingStatus>;

export const PresentMessage = z.discriminatedUnion("type", [
  /** Console announces itself; the stage replies with a full state snapshot. */
  z.object({ type: z.literal("hello"), role: z.enum(["stage", "console"]) }),
  z.object({ type: z.literal("bye"), role: z.enum(["stage", "console"]) }),

  /** Stage → console. The only source of truth for position. */
  z.object({
    type: z.literal("state"),
    sceneIndex: z.number().int().min(0).max(999),
    step: z.number().int().min(0).max(999),
    stepsInScene: z.number().int().min(1).max(999),
    totalScenes: z.number().int().min(0).max(999),
    /** Epoch ms when the presentation began, or null before the first advance. */
    startedAt: z.number().nullable(),
    sceneEnteredAt: z.number(),
    paused: z.boolean(),
    fullscreen: z.boolean(),
  }),

  /** Console → stage. */
  z.object({
    type: z.literal("command"),
    action: z.enum([
      "next",
      "prev",
      "goto",
      "first",
      "last",
      "toggle-pause",
      "reset-timer",
      "blank",
    ]),
    index: z.number().int().min(0).max(999).optional(),
  }),

  /** Console → stage: live pointer position, or hidden. */
  z.object({
    type: z.literal("pointer"),
    point: NormalisedPoint.nullable(),
    tool: PresenterTool,
    color: z.string().max(32),
  }),

  /** Console → stage: the annotation set for one scene, replacing what is there. */
  z.object({
    type: z.literal("annotations"),
    sceneIndex: z.number().int().min(0).max(999),
    annotations: SceneAnnotations,
  }),

  /** Either direction: recording state, so both windows show the same badge. */
  z.object({
    type: z.literal("recording"),
    status: RecordingStatus,
    elapsedMs: z.number().min(0),
    hasCamera: z.boolean(),
    hasMicrophone: z.boolean(),
  }),
]);
export type PresentMessage = z.infer<typeof PresentMessage>;

export function channelName(presentationId: string): string {
  return `captivate-present-${presentationId}`;
}

/**
 * Thin, validated wrapper over BroadcastChannel.
 *
 * Falls back to a no-op channel where BroadcastChannel is unavailable, so
 * single-window presenting still works everywhere.
 */
export class PresentChannel {
  private channel: BroadcastChannel | null = null;
  private handlers = new Set<(message: PresentMessage) => void>();

  constructor(presentationId: string) {
    if (typeof BroadcastChannel === "undefined") return;
    try {
      this.channel = new BroadcastChannel(channelName(presentationId));
      this.channel.onmessage = (event) => {
        const parsed = PresentMessage.safeParse(event.data);
        // Drop anything that does not match the current protocol rather than
        // acting on a half-understood message mid-presentation.
        if (!parsed.success) return;
        for (const handler of this.handlers) handler(parsed.data);
      };
    } catch {
      this.channel = null;
    }
  }

  get available(): boolean {
    return this.channel !== null;
  }

  post(message: PresentMessage): void {
    try {
      this.channel?.postMessage(message);
    } catch {
      // A closing window can throw here; losing one message is harmless.
    }
  }

  on(handler: (message: PresentMessage) => void): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  close(): void {
    this.handlers.clear();
    try {
      this.channel?.close();
    } catch {
      // Already closed.
    }
    this.channel = null;
  }
}

export const emptyAnnotations = (): SceneAnnotations => ({ strokes: [], highlights: [] });
