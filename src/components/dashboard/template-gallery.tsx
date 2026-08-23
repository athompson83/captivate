"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import type { SceneContent } from "@/lib/schema/presentation";
import type { PresentationTheme } from "@/lib/schema/theme";
import { StageThumbnail } from "@/components/stage/stage";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog } from "@/components/ui/dialog";
import { useToast } from "@/components/ui/toast";
import { createPresentation } from "@/lib/data/actions";
import { cn } from "@/lib/utils/cn";

interface TemplatePreview {
  id: string;
  name: string;
  description: string;
  audience: string;
  themeId: string;
  sceneCount: number;
  scenes: { title: string; content: SceneContent }[];
  theme: PresentationTheme;
}

export function TemplateGallery({ templates }: { templates: TemplatePreview[] }) {
  const [chosen, setChosen] = useState<TemplatePreview | null>(null);

  return (
    <div className="mx-auto max-w-6xl px-5 py-8 sm:px-8 sm:py-10">
      <header className="mb-2">
        <h1 className="text-ink text-[22px] font-semibold tracking-tight">Templates</h1>
        <p className="text-ink-3 mt-1.5 max-w-2xl text-[14px] leading-relaxed">
          Six structures rather than a hundred variations on a grid. Each one is a narrative shape
          that works — objectives and a case for teaching, problem and proof for a pitch — with
          prompts in place of filler text.
        </p>
      </header>

      <ul className="mt-7 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {templates.map((template) => (
          <li key={template.id}>
            <button
              onClick={() => setChosen(template)}
              className={cn(
                "group border-line-subtle bg-raised w-full overflow-hidden rounded-[var(--radius-lg)] border text-left",
                "transition-[border-color,transform,box-shadow] duration-[var(--duration-base)]",
                "hover:border-line hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)]",
              )}
            >
              <span className="bg-sunken relative flex aspect-video items-center justify-center overflow-hidden">
                <TemplateThumb content={template.scenes[0]?.content} theme={template.theme} />
              </span>

              <span className="block p-4">
                <span className="flex items-baseline justify-between gap-2">
                  <span className="text-ink text-[14px] font-semibold">{template.name}</span>
                  <span className="text-ink-3 shrink-0 text-[11px]">
                    {template.sceneCount} scenes
                  </span>
                </span>
                <span className="text-ink-3 mt-1.5 block text-[12.5px] leading-relaxed">
                  {template.description}
                </span>
                <span className="text-accent-text mt-2.5 inline-flex items-center gap-1 text-[12px] font-medium">
                  Use this
                  <ArrowRight
                    className="size-3 transition-transform group-hover:translate-x-0.5"
                    aria-hidden
                  />
                </span>
              </span>
            </button>
          </li>
        ))}
      </ul>

      <UseTemplateDialog template={chosen} onClose={() => setChosen(null)} />
    </div>
  );
}

function TemplateThumb({
  content,
  theme,
}: {
  content: SceneContent | undefined;
  theme: PresentationTheme;
}) {
  const [width, setWidth] = useState(0);
  if (!content) return null;

  return (
    <span
      ref={(node) => {
        if (node) setWidth(node.getBoundingClientRect().width);
      }}
      className="absolute inset-0"
    >
      {width > 0 && <StageThumbnail content={content} theme={theme} aspect="16:9" width={width} />}
    </span>
  );
}

function UseTemplateDialog({
  template,
  onClose,
}: {
  template: TemplatePreview | null;
  onClose: () => void;
}) {
  const router = useRouter();
  const { toast } = useToast();
  const [title, setTitle] = useState("");
  const [pending, start] = useTransition();

  const create = () =>
    start(async () => {
      if (!template) return;
      const result = await createPresentation({
        title: title.trim() || template.name,
        themeId: template.themeId,
        templateId: template.id,
      });
      if (!result.ok) {
        toast({ tone: "error", title: "Couldn't create", description: result.error });
        return;
      }
      router.push(`/edit/${result.data.id}`);
    });

  return (
    <Dialog
      open={Boolean(template)}
      onClose={onClose}
      title={template ? `Start from ${template.name}` : ""}
      description={template?.description}
      size="lg"
      footer={
        <>
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" size="sm" onClick={create} loading={pending}>
            Create presentation
          </Button>
        </>
      }
    >
      {template && (
        <div className="space-y-4">
          <Input
            label="Title"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
            placeholder={template.name}
            data-autofocus
          />

          <div>
            <p className="text-ink-3 mb-2 text-[10px] font-medium tracking-wider uppercase">
              First scenes
            </p>
            <ul className="grid grid-cols-3 gap-2">
              {template.scenes.map((scene, i) => (
                <li
                  key={i}
                  className="border-line-subtle overflow-hidden rounded-[var(--radius-sm)] border"
                >
                  <span className="bg-sunken relative flex aspect-video">
                    <TemplateThumb content={scene.content} theme={template.theme} />
                  </span>
                  <span className="text-ink-3 block truncate px-2 py-1 text-[10.5px]">
                    {scene.title}
                  </span>
                </li>
              ))}
            </ul>
          </div>

          <p className="text-ink-3 text-[12px] leading-relaxed">
            All {template.sceneCount} scenes are created and fully editable. Built for{" "}
            {template.audience.toLowerCase()}.
          </p>
        </div>
      )}
    </Dialog>
  );
}
