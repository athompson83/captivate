"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  CornerDownLeft,
  FileText,
  Home,
  Images,
  LayoutTemplate,
  Notebook,
  Plus,
  Search,
  Settings,
  Sparkles,
  Video,
} from "lucide-react";
import { cn } from "@/lib/utils/cn";

interface Command {
  id: string;
  label: string;
  hint?: string;
  icon: React.ComponentType<{ className?: string }>;
  href: string;
  group: "Create" | "Go to";
}

const COMMANDS: Command[] = [
  { id: "new", label: "New presentation", hint: "Start from blank or a template", icon: Plus, href: "/new", group: "Create" },
  { id: "ai", label: "Create with AI", hint: "Describe it and review an outline", icon: Sparkles, href: "/new?mode=ai", group: "Create" },
  { id: "home", label: "Home", icon: Home, href: "/home", group: "Go to" },
  { id: "presentations", label: "Presentations", icon: FileText, href: "/presentations", group: "Go to" },
  { id: "notes", label: "Notes", icon: Notebook, href: "/notes", group: "Go to" },
  { id: "assets", label: "Assets", icon: Images, href: "/assets", group: "Go to" },
  { id: "templates", label: "Templates", icon: LayoutTemplate, href: "/templates", group: "Go to" },
  { id: "recordings", label: "Recordings", icon: Video, href: "/recordings", group: "Go to" },
  { id: "settings", label: "Settings", icon: Settings, href: "/settings", group: "Go to" },
];

interface SearchHit {
  id: string;
  title: string;
  kind: "presentation" | "note";
  href: string;
}

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setHits([]);
      setActive(0);
      setTimeout(() => inputRef.current?.focus(), 30);
    }
  }, [open]);

  // Debounced server search across presentations and notes.
  useEffect(() => {
    if (!open || query.trim().length < 2) {
      setHits([]);
      return;
    }
    const controller = new AbortController();
    const t = setTimeout(async () => {
      try {
        const res = await fetch(`/api/search?q=${encodeURIComponent(query)}`, {
          signal: controller.signal,
        });
        if (!res.ok) return;
        const data = (await res.json()) as { results: SearchHit[] };
        setHits(data.results ?? []);
      } catch {
        // Aborted or offline — the static commands still work.
      }
    }, 180);
    return () => {
      clearTimeout(t);
      controller.abort();
    };
  }, [query, open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return COMMANDS;
    return COMMANDS.filter(
      (c) => c.label.toLowerCase().includes(q) || c.hint?.toLowerCase().includes(q),
    );
  }, [query]);

  const items = useMemo(
    () => [
      ...filtered.map((c) => ({ kind: "command" as const, command: c })),
      ...hits.map((h) => ({ kind: "hit" as const, hit: h })),
    ],
    [filtered, hits],
  );

  useEffect(() => setActive(0), [items.length]);

  const go = (href: string) => {
    onClose();
    router.push(href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActive((i) => Math.min(i + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const item = items[active];
      if (!item) return;
      go(item.kind === "command" ? item.command.href : item.hit.href);
    } else if (e.key === "Escape") {
      onClose();
    }
  };

  let lastGroup = "";

  return (
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[95] flex items-start justify-center px-4 pt-[12vh]">
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.14 }}
            onClick={onClose}
            className="absolute inset-0 bg-black/50 backdrop-blur-[2px]"
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label="Command palette"
            initial={{ opacity: 0, scale: 0.97, y: -8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.98, y: -4 }}
            transition={{ duration: 0.18, ease: [0.22, 1, 0.36, 1] }}
            className="relative w-full max-w-lg overflow-hidden rounded-[var(--radius-xl)] border border-line bg-overlay shadow-[var(--shadow-xl)]"
          >
            <div className="flex items-center gap-2.5 border-b border-line-subtle px-4">
              <Search className="size-4 shrink-0 text-ink-3" aria-hidden />
              <input
                ref={inputRef}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Search presentations and notes, or run a command…"
                aria-label="Search"
                role="combobox"
                aria-expanded
                aria-controls="palette-results"
                className="w-full bg-transparent py-3.5 text-sm text-ink outline-none placeholder:text-ink-3"
              />
            </div>

            <ul id="palette-results" role="listbox" className="max-h-[52vh] overflow-y-auto p-1.5">
              {items.length === 0 && (
                <li className="px-3 py-8 text-center text-[13px] text-ink-3">
                  Nothing matches “{query}”.
                </li>
              )}
              {items.map((item, i) => {
                const isCommand = item.kind === "command";
                const group = isCommand ? item.command.group : "Results";
                const showGroup = group !== lastGroup;
                lastGroup = group;
                const Icon = isCommand ? item.command.icon : item.hit.kind === "note" ? Notebook : FileText;
                const label = isCommand ? item.command.label : item.hit.title;
                const hint = isCommand ? item.command.hint : item.hit.kind === "note" ? "Note" : "Presentation";
                const selected = i === active;

                return (
                  <li key={isCommand ? item.command.id : `hit-${item.hit.kind}-${item.hit.id}`}>
                    {showGroup && (
                      <p className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wider text-ink-3">
                        {group}
                      </p>
                    )}
                    <button
                      role="option"
                      aria-selected={selected}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => go(isCommand ? item.command.href : item.hit.href)}
                      className={cn(
                        "flex w-full items-center gap-3 rounded-[var(--radius-md)] px-2.5 py-2 text-left transition-colors",
                        selected ? "bg-[var(--surface-inset)]" : "hover:bg-[var(--surface-inset)]",
                      )}
                    >
                      <Icon className="size-4 shrink-0 text-ink-3" aria-hidden />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] text-ink">{label}</span>
                        {hint && <span className="block truncate text-[11px] text-ink-3">{hint}</span>}
                      </span>
                      {selected && <CornerDownLeft className="size-3.5 text-ink-3" aria-hidden />}
                    </button>
                  </li>
                );
              })}
            </ul>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}
