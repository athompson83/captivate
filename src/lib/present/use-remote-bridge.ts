"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RemoteChannel } from "./remote-channel";
import type { PresentMessage } from "./protocol";
import type { PresentSession } from "./session";
import type { RemoteSession } from "@/lib/data/remote-sessions";

/**
 * Bridges a phone remote into the presenter's own window.
 *
 * The stage is not on this network. A phone's command arrives here — in the
 * window the presenter is already driving from — and is applied through the
 * same session API a keypress uses, which then reaches the stage over the
 * BroadcastChannel that already carries it. Nothing about the stage changes,
 * and the projector gains no network listener it did not have.
 *
 * State goes the other way for the same reason: this window knows the position
 * because it is a peer of the stage, so it can tell the phone without the
 * stage speaking to the phone at all.
 */
export function useRemoteBridge(session: RemoteSession | null, api: PresentSession): boolean {
  /**
   * Connection state lives outside React.
   *
   * It is written by the transport's own callback and by effect teardown,
   * neither of which is a render, and the compiler is right that calling
   * setState from an effect body is the wrong shape for a value that an
   * external system owns. This is the smallest honest store for it.
   */
  const [link] = useState(() => {
    let value = false;
    const listeners = new Set<() => void>();
    return {
      set(next: boolean) {
        if (next === value) return;
        value = next;
        for (const listener of listeners) listener();
      },
      get: () => value,
      subscribe(listener: () => void) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    };
  });
  const connected = useSyncExternalStore(
    useCallback((listener: () => void) => link.subscribe(listener), [link]),
    link.get,
    () => false,
  );
  const channelRef = useRef<RemoteChannel | null>(null);

  // The session API object is rebuilt on every store change, so it cannot be
  // an effect dependency without tearing the channel down and re-subscribing
  // sixty times a second while the laser is moving. The ref is written in its
  // own effect rather than during render: what is stored is the latest
  // *committed* api, which is exactly what an inbound command should act on.
  const latest = useRef(api);
  useEffect(() => {
    latest.current = api;
  }, [api]);

  useEffect(() => {
    if (!session) {
      link.set(false);
      return;
    }

    const channel = new RemoteChannel({
      sessionId: session.id,
      onStatus: (status) => link.set(status === "connected"),
      onMessage: (message: PresentMessage) => {
        const current = latest.current;
        if (message.type === "command") {
          switch (message.action) {
            case "next":
              current.next();
              break;
            case "prev":
              current.prev();
              break;
            case "goto":
              if (message.index !== undefined) current.goto(message.index);
              break;
            case "first":
              current.first();
              break;
            case "last":
              current.last();
              break;
            case "toggle-pause":
              current.togglePause();
              break;
            case "reset-timer":
              current.resetTimer();
              break;
            case "blank":
              current.toggleBlank();
              break;
            case "overview":
              current.toggleOverview();
              break;
          }
          return;
        }
        if (message.type === "pointer") {
          current.broadcastPointer(message.point, message.tool, message.color);
        }
        // `state`, `annotations`, `recording` and the handshake are this
        // window's to send, not to act on. A phone claiming to be the stage
        // does not get to move anything.
      },
    });
    channelRef.current = channel;

    return () => {
      channel.close();
      channelRef.current = null;
      link.set(false);
    };
  }, [session, link]);

  // Position, whenever it changes. This is also the phone's only honest
  // acknowledgement that a press was acted on, which is why it is sent on
  // every change rather than only on a timer.
  useEffect(() => {
    const channel = channelRef.current;
    if (!channel || !session) return;
    void channel.send({
      type: "state",
      sceneIndex: api.sceneIndex,
      step: api.step,
      stepsInScene: api.stepsInScene,
      totalScenes: api.totalScenes,
      startedAt: api.startedAt,
      sceneEnteredAt: api.sceneEnteredAt,
      paused: api.paused,
      pausedAt: api.pausedAt,
      divePath: api.divePath,
      fullscreen: false,
      overview: api.overview,
      establishing: api.establishing,
    });
  }, [
    session,
    api.sceneIndex,
    api.step,
    api.stepsInScene,
    api.totalScenes,
    api.startedAt,
    api.sceneEnteredAt,
    api.paused,
    api.pausedAt,
    api.divePath,
    api.overview,
    api.establishing,
  ]);

  return connected;
}
