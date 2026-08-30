"use client";

import { useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { AlignCenter, AlignLeft, AlignRight, Bold, Italic, Underline, Wand2 } from "lucide-react";
import type { EntranceAnimation, SceneElement, TextStyle } from "@/lib/schema/presentation";
import type { PresentationTheme } from "@/lib/schema/theme";
import {
  editElement,
  updateSceneMeta,
  useCurrentScene,
  useEditor,
  usePresentationId,
  useSelectedElements,
} from "@/lib/editor/store";
import { Input, Textarea } from "@/components/ui/input";
import { Field, Segmented, Slider, Toggle, Tooltip } from "@/components/ui/misc";
import { DrawingControls } from "./drawing-panel";
import { AssetPicker } from "./asset-picker";
import { cn } from "@/lib/utils/cn";

/**
 * Contextual inspector.
 *
 * Present only when something is selected, and shows only the controls that
 * apply to *that* selection — this is the alternative to a permanent ribbon.
 */
export function Inspector({ theme }: { theme: PresentationTheme }) {
  const selected = useSelectedElements();
  const scene = useCurrentScene();
  const sceneId = scene?.id ?? null;

  const [tab, setTab] = useState<"style" | "motion">("style");

  const single = selected.length === 1 ? selected[0] : null;

  return (
    <AnimatePresence>
      {selected.length > 0 && sceneId && scene && (
        <motion.aside
          key="inspector"
          aria-label="Element inspector"
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 272, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.2, ease: [0.22, 1, 0.36, 1] }}
          className="border-line-subtle bg-base shrink-0 overflow-hidden border-l"
        >
          <div className="flex h-full w-[272px] flex-col">
            <div className="border-line-subtle flex items-center justify-between border-b px-3 py-2.5">
              <span className="text-ink truncate text-[12.5px] font-medium">
                {selected.length > 1 ? `${selected.length} elements` : labelFor(selected[0])}
              </span>
              <Segmented
                label="Inspector tab"
                size="sm"
                value={tab}
                onChange={setTab}
                options={[
                  { value: "style", label: "Style" },
                  { value: "motion", label: "Motion" },
                ]}
              />
            </div>

            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto p-3.5">
              {tab === "style" ? (
                single ? (
                  <StyleControls element={single} sceneId={sceneId} theme={theme} />
                ) : (
                  <p className="text-ink-3 text-[12px] leading-relaxed">
                    Multiple elements selected. Use the floating toolbar to align, order or delete
                    them, or select one to change its style.
                  </p>
                )
              ) : (
                <MotionControls elements={selected} sceneId={sceneId} />
              )}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  );
}

function labelFor(element: SceneElement): string {
  const names: Record<SceneElement["type"], string> = {
    heading: "Heading",
    text: "Text",
    quote: "Quote",
    list: "List",
    image: "Image",
    drawing: "Drawing",
    video: "Video",
    audio: "Audio",
    shape: "Shape",
    divider: "Divider",
    icon: "Icon",
    callout: "Callout",
    code: "Code",
    chart: "Chart",
    embed: "Embed",
  };
  return names[element.type];
}

/* -------------------------------------------------------------------------- */

/**
 * Turns an element into a hotspot.
 *
 * A hotspot dives to a detail scene instead of advancing the argument, so this
 * offers only scenes that are actually asides — pointing one at a main scene
 * would put a shortcut through the middle of the talk, and returning from it
 * would land somewhere the presenter never left.
 */
function HotspotControls({ element, sceneId }: { element: SceneElement; sceneId: string }) {
  const scenes = useEditor((s) => s.document.scenes);
  const hotspot = element.hotspot;

  const candidates = scenes.filter((s) => s.id !== sceneId && s.flowRole === "detail");
  const targetMissing = Boolean(hotspot) && !scenes.some((s) => s.id === hotspot!.targetSceneId);

  const set = (patch: { targetSceneId?: string; label?: string } | null) =>
    editElement(
      sceneId,
      element.id,
      (el) => ({
        ...el,
        hotspot: patch
          ? {
              targetSceneId: patch.targetSceneId ?? el.hotspot?.targetSceneId ?? "",
              label: patch.label ?? el.hotspot?.label ?? "",
            }
          : null,
      }),
      { label: patch ? "Set hotspot" : "Remove hotspot", coalesceKey: `hotspot:${element.id}` },
    );

  return (
    <Field label="Hotspot">
      {candidates.length === 0 && !hotspot ? (
        <p className="text-ink-3 text-[11.5px] leading-relaxed">
          Mark a scene as a detail scene in the navigator, then link to it from here.
        </p>
      ) : (
        <div className="space-y-2">
          <select
            value={hotspot?.targetSceneId ?? ""}
            onChange={(e) => set(e.target.value ? { targetSceneId: e.target.value } : null)}
            aria-label="Hotspot destination"
            className="border-line text-ink-2 w-full appearance-none rounded-[var(--radius-sm)] border bg-[var(--surface-inset)] px-2 py-1.5 text-[11.5px] outline-none"
          >
            <option value="">Not a hotspot</option>
            {candidates.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title.trim() || "Untitled detail scene"}
              </option>
            ))}
          </select>

          {targetMissing && (
            <p className="text-danger text-[11.5px] leading-relaxed">
              This hotspot points at a scene that no longer exists. It will be cleared next time
              the deck is opened.
            </p>
          )}

          {hotspot && (
            <Input
              value={hotspot.label}
              onChange={(e) => set({ label: e.target.value })}
              aria-label="Hotspot label"
              placeholder={"Describe where it goes"}
              className="text-[11.5px]"
            />
          )}
        </div>
      )}
    </Field>
  );
}

function StyleControls({
  element,
  sceneId,
  theme,
}: {
  element: SceneElement;
  sceneId: string;
  theme: PresentationTheme;
}) {
  const presentationId = usePresentationId();
  const patch = <T extends SceneElement>(
    update: (el: T) => T,
    label: string,
    coalesceKey?: string,
  ) => editElement(sceneId, element.id, (el) => update(el as T), { label, coalesceKey });

  const hasText = "style" in element;

  return (
    <>
      {hasText && <TextStyleControls element={element} sceneId={sceneId} />}

      <HotspotControls element={element} sceneId={sceneId} />

      {element.type === "heading" && (
        <Field label="Level">
          <Segmented
            label="Heading level"
            size="sm"
            value={String(element.level)}
            onChange={(v) =>
              patch(
                (el: typeof element) => ({ ...el, level: Number(v) as 1 | 2 | 3 }),
                "Change heading level",
              )
            }
            options={[
              { value: "1", label: "H1" },
              { value: "2", label: "H2" },
              { value: "3", label: "H3" },
            ]}
          />
        </Field>
      )}

      {element.type === "list" && (
        <>
          <Field label="List style">
            <Segmented
              label="List style"
              size="sm"
              value={element.ordered ? "ordered" : "bulleted"}
              onChange={(v) =>
                patch(
                  (el: typeof element) => ({ ...el, ordered: v === "ordered" }),
                  "Change list style",
                )
              }
              options={[
                { value: "bulleted", label: "Bulleted" },
                { value: "ordered", label: "Numbered" },
              ]}
            />
          </Field>
          <Toggle
            label="Reveal one at a time"
            hint="Items appear as you advance, keeping the room with you."
            checked={element.staggered}
            onChange={(v) =>
              patch((el: typeof element) => ({ ...el, staggered: v }), "Toggle stagger")
            }
          />
          <ListItemsEditor element={element} sceneId={sceneId} />
        </>
      )}

      {element.type === "quote" && (
        <Field label="Attribution">
          <Input
            value={element.attribution}
            onChange={(e) =>
              patch(
                (el: typeof element) => ({ ...el, attribution: e.target.value }),
                "Edit attribution",
                `attr-${element.id}`,
              )
            }
            placeholder="Who said it"
          />
        </Field>
      )}

      {element.type === "drawing" && (
        <DrawingControls
          element={element}
          presentationId={presentationId}
          onPatch={(update, label, key) => patch(update, label, key)}
        />
      )}

      {(element.type === "image" || element.type === "video") && (
        <>
          <Field label="Source">
            <AssetPicker
              kind={element.type}
              currentUrl={element.url}
              presentationId={presentationId}
              // An AI-generated scene leaves its image prompt in `alt` beside
              // an empty placeholder, which is exactly the description the
              // author would otherwise retype into search or generation.
              prompt={element.url ? "" : element.alt}
              onSelect={(asset) =>
                patch(
                  (el: typeof element) => ({
                    ...el,
                    url: asset.url,
                    assetId: asset.id,
                    alt: el.alt || asset.alt,
                  }),
                  "Replace media",
                )
              }
            />
          </Field>
          <Field label="Alt text">
            <Textarea
              rows={2}
              value={element.alt}
              onChange={(e) =>
                patch(
                  (el: typeof element) => ({ ...el, alt: e.target.value }),
                  "Edit alt text",
                  `alt-${element.id}`,
                )
              }
              placeholder="Describe the image for screen readers"
              hint="Required for anyone using a screen reader."
            />
          </Field>
        </>
      )}

      {element.type === "image" && (
        <>
          <Field label="Fit">
            <Segmented
              label="Image fit"
              size="sm"
              value={element.fit}
              onChange={(v) => patch((el: typeof element) => ({ ...el, fit: v }), "Change fit")}
              options={[
                { value: "cover", label: "Fill" },
                { value: "contain", label: "Fit" },
                { value: "fill", label: "Stretch" },
              ]}
            />
          </Field>
          {element.fit === "cover" && (
            <Field label="Focal point">
              <FocalPad
                x={element.focalX}
                y={element.focalY}
                onChange={(x, y) =>
                  patch(
                    (el: typeof element) => ({ ...el, focalX: x, focalY: y }),
                    "Move focal point",
                    `focal-${element.id}`,
                  )
                }
              />
            </Field>
          )}
          <Slider
            label="Darken for text"
            value={element.scrim}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) =>
              patch(
                (el: typeof element) => ({ ...el, scrim: v }),
                "Adjust scrim",
                `scrim-${element.id}`,
              )
            }
          />
          <Slider
            label="Corner radius"
            value={element.radius}
            min={0}
            max={8}
            step={0.25}
            format={(v) => v.toFixed(2)}
            onChange={(v) =>
              patch(
                (el: typeof element) => ({ ...el, radius: v }),
                "Adjust radius",
                `radius-${element.id}`,
              )
            }
          />
        </>
      )}

      {element.type === "callout" && (
        <>
          <Field label="Title">
            <Input
              value={element.title}
              onChange={(e) =>
                patch(
                  (el: typeof element) => ({ ...el, title: e.target.value }),
                  "Edit callout title",
                  `ct-${element.id}`,
                )
              }
            />
          </Field>
          <Field label="Tone">
            <Segmented
              label="Callout tone"
              size="sm"
              value={element.tone}
              onChange={(v) => patch((el: typeof element) => ({ ...el, tone: v }), "Change tone")}
              options={[
                { value: "neutral", label: "Neutral" },
                { value: "accent", label: "Accent" },
                { value: "warning", label: "Warn" },
                { value: "danger", label: "Alert" },
              ]}
            />
          </Field>
        </>
      )}

      {element.type === "code" && (
        <Field label="Language">
          <Input
            value={element.language}
            onChange={(e) =>
              patch(
                (el: typeof element) => ({ ...el, language: e.target.value }),
                "Change language",
                `lang-${element.id}`,
              )
            }
            placeholder="javascript"
          />
        </Field>
      )}

      {element.type === "chart" && <ChartControls element={element} sceneId={sceneId} />}

      {element.type === "shape" && (
        <Field label="Shape">
          <Segmented
            label="Shape"
            size="sm"
            value={element.shape}
            onChange={(v) => patch((el: typeof element) => ({ ...el, shape: v }), "Change shape")}
            options={[
              { value: "rectangle", label: "Rect" },
              { value: "ellipse", label: "Ellipse" },
              { value: "triangle", label: "Tri" },
              { value: "arrow", label: "Arrow" },
            ]}
          />
        </Field>
      )}

      {element.type === "embed" && (
        <Field label="URL">
          <Input
            value={element.url}
            onChange={(e) =>
              patch(
                (el: typeof element) => ({ ...el, url: e.target.value }),
                "Change embed URL",
                `embed-${element.id}`,
              )
            }
            placeholder="https://…"
            hint="Embeds are sandboxed and cannot access your account."
          />
        </Field>
      )}

      <Slider
        label="Opacity"
        value={element.opacity}
        min={0.1}
        max={1}
        step={0.05}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) =>
          patch((el) => ({ ...el, opacity: v }), "Adjust opacity", `op-${element.id}`)
        }
      />

      <ColorPalette
        theme={theme}
        current={"style" in element ? element.style.color : undefined}
        onPick={(color) => {
          if (!("style" in element)) return;
          patch(
            (el) => ("style" in el ? { ...el, style: { ...el.style, color } } : el),
            "Change colour",
          );
        }}
        disabled={!hasText}
      />
    </>
  );
}

function TextStyleControls({
  element,
  sceneId,
}: {
  element: SceneElement & { style: TextStyle };
  sceneId: string;
}) {
  const setStyle = (patch: Partial<TextStyle>, label: string, key?: string) =>
    editElement(
      sceneId,
      element.id,
      (el) => ("style" in el ? { ...el, style: { ...el.style, ...patch } } : el),
      { label, coalesceKey: key },
    );

  return (
    <>
      <Field label="Text">
        <div className="flex items-center gap-1">
          <ToggleIcon
            label="Bold"
            active={element.style.weight >= 600}
            icon={Bold}
            onClick={() =>
              setStyle({ weight: element.style.weight >= 600 ? 400 : 700 }, "Toggle bold")
            }
          />
          <ToggleIcon
            label="Italic"
            active={element.style.italic}
            icon={Italic}
            onClick={() => setStyle({ italic: !element.style.italic }, "Toggle italic")}
          />
          <ToggleIcon
            label="Underline"
            active={element.style.underline}
            icon={Underline}
            onClick={() => setStyle({ underline: !element.style.underline }, "Toggle underline")}
          />
          <span aria-hidden className="bg-line-subtle mx-1 h-4 w-px" />
          <ToggleIcon
            label="Align left"
            active={element.style.align === "left"}
            icon={AlignLeft}
            onClick={() => setStyle({ align: "left" }, "Align text")}
          />
          <ToggleIcon
            label="Align centre"
            active={element.style.align === "center"}
            icon={AlignCenter}
            onClick={() => setStyle({ align: "center" }, "Align text")}
          />
          <ToggleIcon
            label="Align right"
            active={element.style.align === "right"}
            icon={AlignRight}
            onClick={() => setStyle({ align: "right" }, "Align text")}
          />
        </div>
      </Field>

      <Slider
        label="Size"
        value={element.style.size}
        min={0.25}
        max={2.5}
        step={0.02}
        format={(v) => `${Math.round(v * 100)}%`}
        onChange={(v) => setStyle({ size: v }, "Change size", `size-${element.id}`)}
      />
      <Slider
        label="Line height"
        value={element.style.lineHeight}
        min={0.9}
        max={2}
        step={0.02}
        format={(v) => v.toFixed(2)}
        onChange={(v) => setStyle({ lineHeight: v }, "Change line height", `lh-${element.id}`)}
      />

      <Field label="Typeface">
        <Segmented
          label="Typeface"
          size="sm"
          value={element.style.family ?? "sans"}
          onChange={(v) => setStyle({ family: v }, "Change typeface")}
          options={[
            { value: "display", label: "Display" },
            { value: "sans", label: "Sans" },
            { value: "mono", label: "Mono" },
          ]}
        />
      </Field>
    </>
  );
}

function MotionControls({ elements, sceneId }: { elements: SceneElement[]; sceneId: string }) {
  const setPreviewStep = useEditor((s) => s.setPreviewStep);
  const first = elements[0];

  const setAnimation = (patch: Partial<SceneElement["animation"]>, label: string, key?: string) => {
    for (const el of elements) {
      editElement(sceneId, el.id, (e) => ({ ...e, animation: { ...e.animation, ...patch } }), {
        label,
        coalesceKey: key,
      });
    }
  };

  const ENTRANCES: { value: EntranceAnimation; label: string }[] = [
    { value: "none", label: "None" },
    { value: "fade", label: "Fade" },
    { value: "rise", label: "Rise" },
    { value: "settle", label: "Settle" },
    { value: "slide-left", label: "Slide left" },
    { value: "slide-right", label: "Slide right" },
    { value: "scale", label: "Scale" },
    { value: "reveal", label: "Reveal" },
    { value: "blur", label: "Focus" },
  ];

  return (
    <>
      <Field label="Entrance">
        <div className="grid grid-cols-3 gap-1">
          {ENTRANCES.map((e) => (
            <button
              key={e.value}
              onClick={() => setAnimation({ entrance: e.value }, "Change entrance")}
              className={cn(
                "rounded-[var(--radius-sm)] border px-1.5 py-1.5 text-[11px] transition-colors",
                first.animation.entrance === e.value
                  ? "border-accent text-accent-text bg-[var(--accent-soft)]"
                  : "border-line-subtle text-ink-3 hover:border-line hover:text-ink-2",
              )}
            >
              {e.label}
            </button>
          ))}
        </div>
      </Field>

      <Slider
        label="Duration"
        value={first.animation.duration}
        min={0.1}
        max={2}
        step={0.05}
        format={(v) => `${v.toFixed(2)}s`}
        onChange={(v) => setAnimation({ duration: v }, "Change duration", "anim-duration")}
      />
      <Slider
        label="Delay"
        value={first.animation.delay}
        min={0}
        max={3}
        step={0.05}
        format={(v) => `${v.toFixed(2)}s`}
        onChange={(v) => setAnimation({ delay: v }, "Change delay", "anim-delay")}
      />

      <Toggle
        label="Wait for me to advance"
        hint="The element appears on your next click or arrow key instead of a timer."
        checked={first.animation.onAdvance}
        onChange={(v) => setAnimation({ onAdvance: v }, "Toggle build")}
      />

      <Field label="Emphasis">
        <Segmented
          label="Emphasis"
          size="sm"
          value={first.animation.emphasis}
          onChange={(v) => setAnimation({ emphasis: v }, "Change emphasis")}
          options={[
            { value: "none", label: "None" },
            { value: "pulse", label: "Pulse" },
            { value: "lift", label: "Lift" },
            { value: "glow", label: "Glow" },
          ]}
        />
      </Field>

      <button
        onClick={() => {
          setPreviewStep(0);
          // Nudging the step forces the stage to replay its entrances.
          requestAnimationFrame(() => setPreviewStep(0));
        }}
        className="border-line text-ink-2 hover:border-line-strong hover:text-ink flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border py-2 text-[12px] font-medium transition-colors"
      >
        <Wand2 className="size-3.5" aria-hidden />
        Preview on the stage
      </button>
    </>
  );
}

function ListItemsEditor({
  element,
  sceneId,
}: {
  element: Extract<SceneElement, { type: "list" }>;
  sceneId: string;
}) {
  return (
    <Field label="Items">
      <div className="space-y-1.5">
        {element.items.map((item, i) => (
          <div key={i} className="flex items-center gap-1.5">
            <Input
              value={item.map((r) => r.text).join("")}
              onChange={(e) =>
                editElement(
                  sceneId,
                  element.id,
                  (el) =>
                    el.type === "list"
                      ? {
                          ...el,
                          items: el.items.map((it, idx) =>
                            idx === i ? [{ text: e.target.value }] : it,
                          ),
                        }
                      : el,
                  { label: "Edit list item", coalesceKey: `list-${element.id}-${i}` },
                )
              }
              aria-label={`List item ${i + 1}`}
              className="!py-1.5 !text-[12px]"
            />
            <button
              onClick={() =>
                editElement(
                  sceneId,
                  element.id,
                  (el) =>
                    el.type === "list"
                      ? { ...el, items: el.items.filter((_, idx) => idx !== i) }
                      : el,
                  { label: "Remove list item" },
                )
              }
              aria-label={`Remove item ${i + 1}`}
              disabled={element.items.length <= 1}
              className="text-ink-3 hover:text-danger shrink-0 rounded p-1 transition-colors disabled:opacity-30"
            >
              ×
            </button>
          </div>
        ))}
        <button
          onClick={() =>
            editElement(
              sceneId,
              element.id,
              (el) =>
                el.type === "list" ? { ...el, items: [...el.items, [{ text: "New point" }]] } : el,
              { label: "Add list item" },
            )
          }
          disabled={element.items.length >= 24}
          className="border-line text-ink-3 hover:border-accent hover:text-accent-text w-full rounded-[var(--radius-sm)] border border-dashed py-1.5 text-[11.5px] transition-colors disabled:opacity-40"
        >
          Add item
        </button>
      </div>
    </Field>
  );
}

function ChartControls({
  element,
  sceneId,
}: {
  element: Extract<SceneElement, { type: "chart" }>;
  sceneId: string;
}) {
  const update = (fn: (el: typeof element) => typeof element, label: string, key?: string) =>
    editElement(sceneId, element.id, (el) => (el.type === "chart" ? fn(el) : el), {
      label,
      coalesceKey: key,
    });

  return (
    <>
      <Field label="Chart type">
        <Segmented
          label="Chart type"
          size="sm"
          value={element.chart}
          onChange={(v) => update((el) => ({ ...el, chart: v }), "Change chart type")}
          options={[
            { value: "column", label: "Column" },
            { value: "bar", label: "Bar" },
            { value: "line", label: "Line" },
            { value: "donut", label: "Donut" },
          ]}
        />
      </Field>

      <Field label="Data">
        <div className="space-y-1.5">
          {element.data.map((point, i) => (
            <div key={i} className="flex items-center gap-1.5">
              <Input
                value={point.label}
                aria-label={`Label ${i + 1}`}
                onChange={(e) =>
                  update(
                    (el) => ({
                      ...el,
                      data: el.data.map((d, idx) =>
                        idx === i ? { ...d, label: e.target.value } : d,
                      ),
                    }),
                    "Edit chart label",
                    `chart-l-${i}`,
                  )
                }
                className="!py-1.5 !text-[12px]"
              />
              <Input
                type="number"
                value={point.value}
                aria-label={`Value ${i + 1}`}
                onChange={(e) =>
                  update(
                    (el) => ({
                      ...el,
                      data: el.data.map((d, idx) =>
                        idx === i ? { ...d, value: Number(e.target.value) || 0 } : d,
                      ),
                    }),
                    "Edit chart value",
                    `chart-v-${i}`,
                  )
                }
                className="w-[70px] shrink-0 !py-1.5 !text-[12px]"
              />
              <button
                onClick={() =>
                  update(
                    (el) => ({ ...el, data: el.data.filter((_, idx) => idx !== i) }),
                    "Remove data point",
                  )
                }
                aria-label={`Remove point ${i + 1}`}
                disabled={element.data.length <= 1}
                className="text-ink-3 hover:text-danger shrink-0 rounded p-1 disabled:opacity-30"
              >
                ×
              </button>
            </div>
          ))}
          <button
            onClick={() =>
              update(
                (el) => ({ ...el, data: [...el.data, { label: "New", value: 0 }] }),
                "Add data point",
              )
            }
            disabled={element.data.length >= 40}
            className="border-line text-ink-3 hover:border-accent hover:text-accent-text w-full rounded-[var(--radius-sm)] border border-dashed py-1.5 text-[11.5px] transition-colors disabled:opacity-40"
          >
            Add data point
          </button>
        </div>
      </Field>

      <Field label="Description">
        <Textarea
          rows={2}
          value={element.summary}
          onChange={(e) =>
            update((el) => ({ ...el, summary: e.target.value }), "Edit chart summary", "chart-sum")
          }
          placeholder="Describe what the chart shows"
          hint="Read aloud by screen readers in place of the chart."
        />
      </Field>
    </>
  );
}

/* -------------------------------------------------------------------------- */
/* Small controls                                                              */
/* -------------------------------------------------------------------------- */

function ToggleIcon({
  label,
  active,
  icon: Icon,
  onClick,
}: {
  label: string;
  active: boolean;
  icon: React.ComponentType<{ className?: string }>;
  onClick: () => void;
}) {
  return (
    <Tooltip label={label} side="bottom">
      <button
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={cn(
          "flex size-7 items-center justify-center rounded-[var(--radius-sm)] transition-colors",
          active ? "text-ink bg-[var(--surface-inset)]" : "text-ink-3 hover:text-ink",
        )}
      >
        <Icon className="size-3.5" />
      </button>
    </Tooltip>
  );
}

function ColorPalette({
  theme,
  current,
  onPick,
  disabled,
}: {
  theme: PresentationTheme;
  current?: { kind: "token"; token: string } | { kind: "hex"; hex: string };
  onPick: (c: { kind: "token"; token: string }) => void;
  disabled?: boolean;
}) {
  if (disabled) return null;
  const tokens: (keyof PresentationTheme["tokens"])[] = ["ink", "inkMuted", "accent", "surface"];

  return (
    <Field label="Colour">
      <div className="flex items-center gap-1.5">
        {tokens.map((token) => (
          <button
            key={token}
            onClick={() => onPick({ kind: "token", token })}
            aria-label={`Use ${token} colour`}
            aria-pressed={current?.kind === "token" && current.token === token}
            className={cn(
              "size-6 rounded-full border-2 transition-transform hover:scale-110",
              current?.kind === "token" && current.token === token
                ? "border-accent"
                : "border-line-subtle",
            )}
            style={{ background: theme.tokens[token] }}
          />
        ))}
      </div>
      <p className="text-ink-3 mt-1.5 text-[10.5px] leading-snug">
        Theme colours, so re-theming keeps everything coherent.
      </p>
    </Field>
  );
}

/** Drag to set the crop focal point of a `cover` image. */
function FocalPad({
  x,
  y,
  onChange,
}: {
  x: number;
  y: number;
  onChange: (x: number, y: number) => void;
}) {
  const handle = (e: React.PointerEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onChange(
      Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width)),
      Math.min(1, Math.max(0, (e.clientY - rect.top) / rect.height)),
    );
  };

  return (
    <div
      role="application"
      aria-label="Image focal point"
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        handle(e);
      }}
      onPointerMove={(e) => {
        if (e.buttons === 1) handle(e);
      }}
      className="border-line relative aspect-video w-full cursor-crosshair rounded-[var(--radius-sm)] border bg-[var(--surface-inset)]"
    >
      <span
        aria-hidden
        className="bg-accent absolute size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[var(--shadow-sm)]"
        style={{ left: `${x * 100}%`, top: `${y * 100}%` }}
      />
    </div>
  );
}

export { updateSceneMeta };
