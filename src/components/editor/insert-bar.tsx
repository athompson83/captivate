"use client";

import { useState } from "react";
import {
  BarChart3,
  Code2,
  Image as ImageIcon,
  Layout,
  Lightbulb,
  List,
  Minus,
  Music,
  Plus,
  Quote,
  Shapes,
  Sparkles,
  Star,
  Type,
  Video as VideoIcon,
} from "lucide-react";
import type { SceneElementType, SceneLayout } from "@/lib/schema/presentation";
import { ALL_LAYOUTS, relayoutScene } from "@/lib/editor/layouts";
import { createElement, INSERTABLE } from "@/lib/editor/element-factory";
import { addElementToScene, editSceneContent, useCurrentScene } from "@/lib/editor/store";
import { Popover } from "@/components/ui/misc";
import { cn } from "@/lib/utils/cn";

const ICONS: Record<SceneElementType, React.ComponentType<{ className?: string }>> = {
  heading: Type,
  text: Type,
  list: List,
  quote: Quote,
  callout: Lightbulb,
  code: Code2,
  image: ImageIcon,
  video: VideoIcon,
  audio: Music,
  embed: Layout,
  chart: BarChart3,
  shape: Shapes,
  icon: Star,
  divider: Minus,
};

/**
 * The insertion surface. Sits at the foot of the canvas rather than in a
 * permanent ribbon, and offers the two things a user actually wants here:
 * add something, or change how this scene is composed.
 */
export function InsertBar({ sceneId }: { sceneId: string }) {
  const scene = useCurrentScene();
  const [insertOpen, setInsertOpen] = useState(false);
  const [layoutOpen, setLayoutOpen] = useState(false);

  const insert = (type: SceneElementType) => {
    setInsertOpen(false);
    addElementToScene(sceneId, createElement(type), `Add ${type}`);
  };

  const applyLayout = (layout: SceneLayout) => {
    setLayoutOpen(false);
    if (!scene) return;
    editSceneContent(sceneId, (content) => relayoutScene(content, layout), {
      label: "Change layout",
    });
  };

  const groups = ["Text", "Media", "Objects"];

  return (
    <div className="border-line-subtle bg-base/70 flex shrink-0 items-center justify-center gap-2 border-t px-4 py-2.5 backdrop-blur-sm">
      <div className="relative">
        <button
          onClick={() => {
            setInsertOpen((v) => !v);
            setLayoutOpen(false);
          }}
          aria-haspopup="menu"
          aria-expanded={insertOpen}
          className="bg-accent flex items-center gap-1.5 rounded-[var(--radius-md)] px-3 py-1.5 text-[12.5px] font-medium text-[var(--accent-contrast)] transition-opacity hover:opacity-90"
        >
          <Plus className="size-3.5" aria-hidden />
          Insert
        </button>

        <Popover
          open={insertOpen}
          onClose={() => setInsertOpen(false)}
          anchor="top-start"
          className="w-[260px]"
        >
          <div role="menu" className="max-h-[46vh] overflow-y-auto">
            {groups.map((group) => (
              <div key={group}>
                <p className="text-ink-3 px-2.5 pt-2 pb-1 text-[10px] font-medium tracking-wider uppercase">
                  {group}
                </p>
                <div className="grid grid-cols-2 gap-0.5">
                  {INSERTABLE.filter((i) => i.group === group).map(({ type, label }) => {
                    const Icon = ICONS[type];
                    return (
                      <button
                        key={type}
                        role="menuitem"
                        onClick={() => insert(type)}
                        className="text-ink-2 hover:text-ink flex items-center gap-2 rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left text-[12.5px] transition-colors hover:bg-[var(--surface-inset)]"
                      >
                        <Icon className="text-ink-3 size-3.5 shrink-0" aria-hidden />
                        {label}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        </Popover>
      </div>

      <div className="relative">
        <button
          onClick={() => {
            setLayoutOpen((v) => !v);
            setInsertOpen(false);
          }}
          aria-haspopup="menu"
          aria-expanded={layoutOpen}
          className="border-line text-ink-2 hover:border-line-strong hover:text-ink flex items-center gap-1.5 rounded-[var(--radius-md)] border px-3 py-1.5 text-[12.5px] font-medium transition-colors"
        >
          <Layout className="size-3.5" aria-hidden />
          Layout
          {scene && scene.content.layout !== "custom" && (
            <span className="text-ink-3 text-[11px]">
              · {ALL_LAYOUTS.find((l) => l.value === scene.content.layout)?.label}
            </span>
          )}
        </button>

        <Popover
          open={layoutOpen}
          onClose={() => setLayoutOpen(false)}
          anchor="top-start"
          className="w-[292px]"
        >
          <div role="menu" className="max-h-[46vh] overflow-y-auto">
            <p className="text-ink-3 px-2.5 pt-1 pb-1.5 text-[11px] leading-snug">
              Re-flows this scene&apos;s content into a designed composition. Your text is kept.
            </p>
            <div className="grid grid-cols-2 gap-0.5">
              {ALL_LAYOUTS.map((layout) => (
                <button
                  key={layout.value}
                  role="menuitem"
                  onClick={() => applyLayout(layout.value)}
                  className={cn(
                    "rounded-[var(--radius-sm)] px-2.5 py-1.5 text-left transition-colors hover:bg-[var(--surface-inset)]",
                    scene?.content.layout === layout.value && "bg-[var(--surface-inset)]",
                  )}
                >
                  <span className="text-ink block text-[12.5px]">{layout.label}</span>
                  <span className="text-ink-3 block text-[10.5px]">{layout.hint}</span>
                </button>
              ))}
            </div>
          </div>
        </Popover>
      </div>

      <span className="text-ink-3 ml-1 hidden items-center gap-1.5 text-[11px] sm:flex">
        <Sparkles className="text-ai size-3" aria-hidden />
        Press <kbd className="border-line-subtle rounded border px-1 font-sans text-[10px]">
          I
        </kbd>{" "}
        for AI
      </span>
    </div>
  );
}
