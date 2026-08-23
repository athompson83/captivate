"use client";

import { createContext, useCallback, useContext, useMemo, useSyncExternalStore } from "react";

type ThemePref = "system" | "light" | "dark";

const STORAGE_KEY = "captivate-theme";

/**
 * Theme preference.
 *
 * Backed by `useSyncExternalStore` rather than an effect: the value lives in
 * localStorage and in the OS media query, both of which are external stores.
 * This is also what makes SSR safe — the server snapshot is "system", and React
 * swaps in the real value after hydration without a mismatch warning.
 */

const listeners = new Set<() => void>();

function emit() {
  for (const listener of listeners) listener();
}

function subscribe(onChange: () => void) {
  listeners.add(onChange);
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  window.addEventListener("storage", onChange);
  return () => {
    listeners.delete(onChange);
    mq.removeEventListener("change", onChange);
    window.removeEventListener("storage", onChange);
  };
}

function readPreference(): ThemePref {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // Private browsing or blocked storage; fall through to the default.
  }
  return "system";
}

/**
 * Snapshot combines the preference and the resolved mode into one string so
 * `useSyncExternalStore`'s identity check stays cheap and stable.
 */
function getSnapshot(): `${ThemePref}:${"light" | "dark"}` {
  const pref = readPreference();
  const dark =
    pref === "dark" ||
    (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  const resolved = dark ? "dark" : "light";

  // Keep the document attribute in step with the store. The inline script in
  // the document head already did this for first paint; this covers changes.
  const root = document.documentElement;
  if (root.getAttribute("data-theme") !== resolved) root.setAttribute("data-theme", resolved);

  return `${pref}:${resolved}`;
}

const getServerSnapshot = () => "system:dark" as const;

const ThemeContext = createContext<{
  pref: ThemePref;
  resolved: "light" | "dark";
  setPref: (p: ThemePref) => void;
}>({ pref: "system", resolved: "dark", setPref: () => {} });

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const setPref = useCallback((next: ThemePref) => {
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Preference cannot be persisted; the change below still applies now.
    }
    emit();
  }, []);

  const value = useMemo(() => {
    const [pref, resolved] = snapshot.split(":") as [ThemePref, "light" | "dark"];
    return { pref, resolved, setPref };
  }, [snapshot, setPref]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext);
