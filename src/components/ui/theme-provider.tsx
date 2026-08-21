"use client";

import { createContext, useCallback, useContext, useEffect, useState } from "react";

type ThemePref = "system" | "light" | "dark";

const ThemeContext = createContext<{
  pref: ThemePref;
  resolved: "light" | "dark";
  setPref: (p: ThemePref) => void;
}>({ pref: "system", resolved: "dark", setPref: () => {} });

const STORAGE_KEY = "captivate-theme";

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [pref, setPrefState] = useState<ThemePref>("system");
  const [resolved, setResolved] = useState<"light" | "dark">("dark");

  useEffect(() => {
    const stored = (localStorage.getItem(STORAGE_KEY) as ThemePref | null) ?? "system";
    setPrefState(stored);
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = pref === "dark" || (pref === "system" && mq.matches);
      document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
      setResolved(dark ? "dark" : "light");
    };
    apply();
    if (pref === "system") {
      mq.addEventListener("change", apply);
      return () => mq.removeEventListener("change", apply);
    }
  }, [pref]);

  const setPref = useCallback((p: ThemePref) => {
    setPrefState(p);
    try {
      localStorage.setItem(STORAGE_KEY, p);
    } catch {
      // Private browsing; the in-memory preference still applies.
    }
  }, []);

  return (
    <ThemeContext.Provider value={{ pref, resolved, setPref }}>{children}</ThemeContext.Provider>
  );
}

export const useTheme = () => useContext(ThemeContext);
