"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { AlertTriangle, Check, Info, X } from "lucide-react";
import { cn } from "@/lib/utils/cn";

type ToastTone = "success" | "error" | "info";

interface Toast {
  id: string;
  title: string;
  description?: string;
  tone: ToastTone;
  action?: { label: string; onClick: () => void };
}

const ToastContext = createContext<{
  toast: (t: Omit<Toast, "id">) => void;
  dismiss: (id: string) => void;
}>({ toast: () => {}, dismiss: () => {} });

const TONE_ICON = { success: Check, error: AlertTriangle, info: Info } as const;
const TONE_CLASS: Record<ToastTone, string> = {
  success: "text-success",
  error: "text-danger",
  info: "text-ink-2",
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    setToasts((t) => t.filter((x) => x.id !== id));
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
  }, []);

  const toast = useCallback(
    (t: Omit<Toast, "id">) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev.slice(-3), { ...t, id }]);
      // Errors linger; they usually need a decision from the user.
      const ttl = t.tone === "error" ? 8000 : 4200;
      timers.current.set(
        id,
        setTimeout(() => dismiss(id), ttl),
      );
    },
    [dismiss],
  );

  // The map outlives any single toast, so it is the thing that has to be
  // emptied — otherwise every toast raised in the session leaves a timeout
  // pending against a provider that no longer exists.
  useEffect(() => {
    const pending = timers.current;
    return () => {
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
    };
  }, []);

  const value = useMemo(() => ({ toast, dismiss }), [toast, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div
        // Polite so a save confirmation never interrupts what a screen reader
        // is currently announcing.
        aria-live="polite"
        aria-atomic="false"
        className="pointer-events-none fixed bottom-5 left-1/2 z-[100] flex w-full max-w-sm -translate-x-1/2 flex-col gap-2 px-4"
      >
        <AnimatePresence initial={false}>
          {toasts.map((t) => {
            const Icon = TONE_ICON[t.tone];
            return (
              <motion.div
                key={t.id}
                layout
                initial={{ opacity: 0, y: 16, scale: 0.97 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 8, scale: 0.97 }}
                transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
                className="border-line bg-overlay pointer-events-auto flex items-start gap-3 rounded-[var(--radius-lg)] border px-4 py-3 shadow-[var(--shadow-lg)]"
              >
                <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_CLASS[t.tone])} aria-hidden />
                <div className="min-w-0 flex-1">
                  <p className="text-ink text-[13px] font-medium">{t.title}</p>
                  {t.description && (
                    <p className="text-ink-3 mt-0.5 text-xs leading-relaxed">{t.description}</p>
                  )}
                  {t.action && (
                    <button
                      onClick={() => {
                        t.action!.onClick();
                        dismiss(t.id);
                      }}
                      className="text-accent-text mt-2 text-xs font-medium hover:underline"
                    >
                      {t.action.label}
                    </button>
                  )}
                </div>
                <button
                  onClick={() => dismiss(t.id)}
                  aria-label="Dismiss notification"
                  className="text-ink-3 hover:text-ink -mr-1 rounded p-1 transition-colors"
                >
                  <X className="size-3.5" aria-hidden />
                </button>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => useContext(ToastContext);
