"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Circle, Radio, Square } from "lucide-react";
import { RemoteChannel } from "@/lib/present/remote-channel";
import { CONFIRM_TIMEOUT_MS, type RemoteStatus } from "@/lib/present/remote";
import type { NormalisedPoint, PresentMessage } from "@/lib/present/protocol";
import type { RemoteSession } from "@/lib/data/remote-sessions";

/**
 * Remote-control basics, for a phone held in one hand at the side of a room.
 *
 * Deliberately not the console. Everything here is something a presenter needs
 * while walking and not looking down: where they are, forward, back, blank,
 * and the laser. Notes and timers are not merely hidden — the route above does
 * not load them.
 *
 * Targets are far larger than the 28px the desktop UI uses. That minimum is
 * about reachability with a mouse; this is about hitting the right control
 * with a thumb while facing an audience.
 */

const STATUS_LABEL: Record<RemoteStatus, string> = {
  disconnected: "Not connected",
  reconnecting: "Reconnecting…",
  connected: "Connected",
  sent: "Sending…",
  confirmed: "Done",
};

/** How far a finger must travel to move the pointer across the whole stage. */
const TOUCHPAD_SENSITIVITY = 1.6;

function clampPoint(value: number): number {
  return Math.min(1.2, Math.max(-0.2, value));
}

export function PhoneRemote({
  title,
  presentationId,
  session,
}: {
  title: string;
  presentationId: string;
  session: RemoteSession | null;
}) {
  const [status, setStatus] = useState<RemoteStatus>("disconnected");
  const [sceneIndex, setSceneIndex] = useState<number | null>(null);
  const [totalScenes, setTotalScenes] = useState<number | null>(null);
  const [blanked, setBlanked] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const channelRef = useRef<RemoteChannel | null>(null);
  /**
   * What the phone is waiting to see before it claims a press worked.
   *
   * The transport confirming delivery only proves the message reached the
   * service. The stage's next `state` broadcast is the only thing that proves
   * the stage acted — and it already flows, so this costs nothing.
   */
  const pending = useRef<{ check: (m: PresentMessage) => boolean; timer: number } | null>(null);

  const settle = useCallback((next: RemoteStatus) => {
    if (pending.current) {
      clearTimeout(pending.current.timer);
      pending.current = null;
    }
    setStatus(next);
  }, []);

  const onMessage = useCallback(
    (message: PresentMessage) => {
      if (message.type !== "state") return;
      setSceneIndex(message.sceneIndex);
      setTotalScenes(message.totalScenes);
      if (pending.current?.check(message)) {
        settle("confirmed");
        setNote(null);
        window.setTimeout(() => setStatus((s) => (s === "confirmed" ? "connected" : s)), 900);
      }
    },
    [settle],
  );

  useEffect(() => {
    if (!session) return;
    const channel = new RemoteChannel({
      sessionId: session.id,
      onMessage,
      onStatus: (next) => setStatus((current) => (current === "sent" ? current : next)),
    });
    channelRef.current = channel;
    return () => {
      channel.close();
      channelRef.current = null;
    };
  }, [session, onMessage]);

  /** Sends a command and waits for the stage to say it happened. */
  const command = useCallback(
    (message: PresentMessage, expect: (m: PresentMessage) => boolean) => {
      const channel = channelRef.current;
      if (!channel) return;
      setNote(null);
      setStatus("sent");
      if (pending.current) clearTimeout(pending.current.timer);
      pending.current = {
        check: expect,
        timer: window.setTimeout(() => {
          pending.current = null;
          setStatus("connected");
          setNote("The stage didn't confirm that. Try again.");
        }, CONFIRM_TIMEOUT_MS),
      };

      void channel.send(message).then((handedOff) => {
        if (!handedOff) {
          settle("connected");
          setNote("Couldn't send that. Check the connection.");
        }
      });
    },
    [settle],
  );

  const atIndex = sceneIndex;
  const next = () =>
    command({ type: "command", action: "next" }, (m) =>
      m.type === "state" ? atIndex === null || m.sceneIndex !== atIndex : false,
    );
  const prev = () =>
    command({ type: "command", action: "prev" }, (m) =>
      m.type === "state" ? atIndex === null || m.sceneIndex !== atIndex : false,
    );
  const blank = () => {
    // The stage's `state` carries no blanked flag, so this is the one control
    // whose effect the phone cannot observe. It reports sent, not confirmed,
    // rather than claiming a confirmation it did not receive.
    const channel = channelRef.current;
    if (!channel) return;
    setBlanked((value) => !value);
    void channel.send({ type: "command", action: "blank" });
  };

  const position = useMemo(() => {
    if (atIndex === null || totalScenes === null) return "—";
    return `${atIndex + 1} / ${totalScenes}`;
  }, [atIndex, totalScenes]);

  if (!session) {
    return (
      <main className="grid min-h-dvh place-items-center bg-black px-6 text-center">
        <div className="max-w-xs">
          <Radio className="mx-auto mb-4 size-7 text-white/40" aria-hidden />
          <h1 className="text-[17px] font-medium text-white">This remote link isn&apos;t live</h1>
          <p className="mt-2 text-[13.5px] leading-relaxed text-white/55">
            A remote session ends when the presenter disconnects it, and expires on its own after a
            while. Start a new one from the presenter console and scan the code again.
          </p>
          <Link
            href={`/present/${presentationId}/console`}
            className="mt-6 inline-flex min-h-12 items-center rounded-full border border-white/15 px-5 text-[14px] font-medium text-white/80"
          >
            Open the console
          </Link>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-dvh flex-col bg-black px-4 pt-4 pb-6 text-white select-none">
      <header className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate text-[13px] font-medium text-white/85">{title}</p>
          <p className="text-[11.5px] text-white/45" aria-live="polite">
            {STATUS_LABEL[status]}
          </p>
        </div>
        <p className="shrink-0 text-[22px] font-semibold tabular-nums" aria-live="polite">
          {position}
        </p>
      </header>

      {note && (
        <p className="mt-3 rounded-xl bg-white/10 px-3 py-2 text-[12.5px] text-white/80" role="alert">
          {note}
        </p>
      )}

      <Touchpad channel={channelRef} />

      <div className="mt-4 grid grid-cols-2 gap-3">
        <button
          onClick={prev}
          className="flex min-h-24 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.06] active:bg-white/15"
        >
          <ChevronLeft className="size-9" aria-hidden />
          <span className="sr-only">Previous scene</span>
        </button>
        <button
          onClick={next}
          className="flex min-h-24 items-center justify-center rounded-2xl border border-white/12 bg-white/[0.06] active:bg-white/15"
        >
          <ChevronRight className="size-9" aria-hidden />
          <span className="sr-only">Next scene</span>
        </button>
      </div>

      <button
        onClick={blank}
        aria-pressed={blanked}
        className="mt-3 flex min-h-16 items-center justify-center gap-2 rounded-2xl border border-white/12 bg-white/[0.06] text-[15px] font-medium active:bg-white/15"
      >
        {blanked ? <Circle className="size-5" aria-hidden /> : <Square className="size-5" aria-hidden />}
        {blanked ? "Show the stage" : "Blank the stage"}
      </button>
    </main>
  );
}

/**
 * The laser, as a trackpad rather than an aiming device.
 *
 * Not the gyroscope, and not an absolute mapping of this screen onto the
 * stage: the two have unrelated dimensions, so an absolute mapping is either
 * wrong or needs a live mirror of the stage on the phone. Relative motion is
 * how a trackpad and a real laser pointer both already work.
 *
 * The pointer exists only while a finger is down. On the console the laser
 * follows the mouse on hover and clears on leave; a touchscreen has no hover,
 * so contact is the direct translation of that state rather than a new
 * interaction invented for the phone.
 */
function Touchpad({ channel }: { channel: React.RefObject<RemoteChannel | null> }) {
  const point = useRef<NormalisedPoint>({ x: 0.5, y: 0.5 });
  const last = useRef<{ x: number; y: number } | null>(null);
  const [active, setActive] = useState(false);

  const send = (next: NormalisedPoint | null) => {
    void channel.current?.send({
      type: "pointer",
      point: next,
      tool: next ? "laser" : "none",
      color: "#F0B858",
    });
  };

  return (
    <div
      role="application"
      aria-label="Laser touchpad. Drag to move the pointer on the stage."
      className={`mt-4 flex flex-1 touch-none items-center justify-center rounded-2xl border transition-colors ${
        active ? "border-white/25 bg-white/[0.09]" : "border-white/12 bg-white/[0.04]"
      }`}
      onTouchStart={(e) => {
        const touch = e.changedTouches[0];
        if (!touch) return;
        // Each touch starts the pointer centred: a relative device has no
        // memory of where it was, and neither does a real laser.
        point.current = { x: 0.5, y: 0.5 };
        last.current = { x: touch.clientX, y: touch.clientY };
        setActive(true);
        send(point.current);
      }}
      onTouchMove={(e) => {
        const touch = e.changedTouches[0];
        const previous = last.current;
        if (!touch || !previous) return;
        const rect = e.currentTarget.getBoundingClientRect();
        point.current = {
          x: clampPoint(
            point.current.x + ((touch.clientX - previous.x) / rect.width) * TOUCHPAD_SENSITIVITY,
          ),
          y: clampPoint(
            point.current.y + ((touch.clientY - previous.y) / rect.height) * TOUCHPAD_SENSITIVITY,
          ),
        };
        last.current = { x: touch.clientX, y: touch.clientY };
        send(point.current);
      }}
      onTouchEnd={() => {
        last.current = null;
        setActive(false);
        send(null);
      }}
      onTouchCancel={() => {
        last.current = null;
        setActive(false);
        send(null);
      }}
    >
      <span className="pointer-events-none text-[12.5px] text-white/35">
        {active ? "Pointing" : "Drag here for the laser"}
      </span>
    </div>
  );
}
