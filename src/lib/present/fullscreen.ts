"use client";

import { useEffect, useState, useSyncExternalStore } from "react";

/**
 * Fullscreen, with an honest failure mode.
 *
 * The Fullscreen API needs a user gesture and can be refused outright — inside
 * an iframe, on some managed devices, or on iOS where element fullscreen does
 * not exist. When that happens the app says so and falls back to a maximised
 * in-page stage rather than pretending it worked.
 *
 * Fullscreen state is read with `useSyncExternalStore` because the document is
 * exactly that: an external store that can change without React's involvement
 * (the user pressing Escape, for instance).
 */

function subscribeFullscreen(onChange: () => void) {
  document.addEventListener("fullscreenchange", onChange);
  document.addEventListener("webkitfullscreenchange", onChange);
  return () => {
    document.removeEventListener("fullscreenchange", onChange);
    document.removeEventListener("webkitfullscreenchange", onChange);
  };
}

/**
 * The prefixed API is not history: Safari on iPad still exposes only the
 * `webkit` names, and a viewer that read the standard ones alone reported a
 * fullscreen stage as windowed and never asked for one.
 */
type PrefixedDocument = Document & {
  webkitFullscreenEnabled?: boolean;
  webkitFullscreenElement?: Element | null;
  webkitExitFullscreen?: () => Promise<void> | void;
};
type PrefixedElement = HTMLElement & { webkitRequestFullscreen?: () => Promise<void> | void };

const prefixed = () => document as PrefixedDocument;

/** The element that is fullscreen, by either name. */
export function fullscreenElement(): Element | null {
  return document.fullscreenElement ?? prefixed().webkitFullscreenElement ?? null;
}

/** Asks for fullscreen by whichever name the browser has; throws if neither. */
export async function requestFullscreen(element: HTMLElement): Promise<void> {
  if (typeof element.requestFullscreen === "function") {
    await element.requestFullscreen({ navigationUI: "hide" });
    return;
  }
  const webkit = (element as PrefixedElement).webkitRequestFullscreen;
  if (typeof webkit === "function") {
    await webkit.call(element);
    return;
  }
  throw new Error("Fullscreen is not available here.");
}

async function exitFullscreen(): Promise<void> {
  if (typeof document.exitFullscreen === "function") {
    await document.exitFullscreen();
    return;
  }
  await prefixed().webkitExitFullscreen?.();
}

const isFullscreen = () => Boolean(fullscreenElement());
const serverFullscreen = () => false;

/**
 * Support is a fixed capability of the browser, so it never notifies — but it
 * can only be read on the client, which is exactly what a server snapshot is
 * for. Reading it this way avoids a state update on mount.
 */
const subscribeNever = () => () => {};
// `||`, not `??`: a browser that has the standard flag set to false and the
// prefixed one true is asking to be used by the prefixed name.
const readSupport = () => Boolean(document.fullscreenEnabled || prefixed().webkitFullscreenEnabled);
const assumeSupported = () => true;

export function useFullscreen(target?: React.RefObject<HTMLElement | null>) {
  const active = useSyncExternalStore(subscribeFullscreen, isFullscreen, serverFullscreen);
  const supported = useSyncExternalStore(subscribeNever, readSupport, assumeSupported);
  const [denied, setDenied] = useState(false);

  // Plain functions: with the React Compiler enabled, hand-written useCallback
  // wrappers that read `ref.current` cannot be preserved and are unnecessary.
  const enter = async () => {
    const element = target?.current ?? document.documentElement;
    try {
      await requestFullscreen(element);
      setDenied(false);
      return true;
    } catch {
      setDenied(true);
      return false;
    }
  };

  const exit = async () => {
    try {
      if (fullscreenElement()) await exitFullscreen();
    } catch {
      // Already exited, or refused; the subscription settles the real state.
    }
  };

  const toggle = async () => {
    if (fullscreenElement()) {
      await exit();
      return false;
    }
    return enter();
  };

  return { active, supported, denied, enter, exit, toggle };
}

/** Keeps the display awake for the length of a presentation, where supported. */
export function useWakeLock(enabled: boolean) {
  useEffect(() => {
    if (!enabled || typeof navigator === "undefined" || !("wakeLock" in navigator)) return;

    let sentinel: WakeLockSentinel | null = null;
    let cancelled = false;

    const request = async () => {
      try {
        sentinel = await navigator.wakeLock.request("screen");
      } catch {
        // Denied or unsupported; the screen may dim, which is not fatal.
      }
    };

    void request();

    // The lock is dropped when the tab is hidden and must be re-taken.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !cancelled) void request();
    };
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      cancelled = true;
      document.removeEventListener("visibilitychange", onVisible);
      void sentinel?.release().catch(() => {});
    };
  }, [enabled]);
}
