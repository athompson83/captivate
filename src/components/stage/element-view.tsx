"use client";

import { createElement, memo, useEffect, useId, useMemo, useRef } from "react";
import { useReducedMotion } from "motion/react";
import * as Icons from "lucide-react";
import type { RichText, SceneElement, TextStyle } from "@/lib/schema/presentation";
import { DrawnPicture, handWobble } from "./drawn-picture";
import { blobPath } from "@/lib/drawing/diagram";
import { chartDrawing } from "@/lib/drawing/chart";
import { coversStage, gradeMatrix } from "@/lib/present/grade";
import { GradeFilter } from "./grade-filter";
import { embedSandbox } from "@/lib/utils/embed";
import { resolveColor, type PresentationTheme } from "@/lib/schema/theme";
import { stageRem } from "@/lib/present/stage";
import { COUNT_MS, figureAt, formatFigure, parseFigure } from "@/lib/present/count-up";
import {
  MARK_DELAY_S,
  MARK_DURATION_S,
  MARK_STAGGER_S,
  MARK_WEIGHT,
  isAccentRun,
  underlinePath,
} from "@/lib/present/hand-mark";
import { DEFAULT_ICON, ICON_NAMES } from "@/lib/schema/icons";
import {
  fitListSize,
  fitTextSize,
  textMetrics,
  LIST_ITEM_GAP_EMS,
  LIST_MARKER_GAP_EMS,
  LIST_MARKER_WIDTH_EMS,
  LIST_ORDERED_MARKER_WIDTH_EMS,
} from "@/lib/present/fit-text";

/**
 * Renders one scene element.
 *
 * Text is rendered from the typed `RichText` run array — never from HTML — so
 * there is no sanitisation surface and no way for stored content to inject
 * markup into the stage.
 */

interface Props {
  element: SceneElement;
  theme: PresentationTheme;
  stageWidth: number;
  /** Stage height in px, used together with the frame to auto-fit text. */
  stageHeight?: number;
  /**
   * The element is being performed for a room right now: the camera has
   * landed on its scene and it is being presented, not edited or previewed.
   * Figures count up and charts build. Off by default — the editor, a
   * thumbnail and a scene the camera is passing show the finished thing.
   */
  perform?: boolean;
}

/**
 * Curated icon set — an arbitrary name can never resolve to a random import.
 *
 * Keyed by `ICON_NAMES`, which lives in a plain module because the generation
 * schema needs the same list and cannot import a client component tree to get
 * it. That sharing is the point: a model can only ask for an icon that exists,
 * so a name it invents fails validation rather than landing here and resolving
 * to a plain circle, which is what every generated card used to be.
 *
 * `icon-registry.test.ts` asserts this map covers the list exactly. A name
 * added to one and not the other is otherwise silent.
 */
const ICONS: Record<
  string,
  React.ComponentType<{ className?: string; style?: React.CSSProperties; strokeWidth?: number }>
> = {
  // Structure and sequence
  circle: Icons.Circle,
  check: Icons.Check,
  "check-circle": Icons.CheckCircle2,
  x: Icons.X,
  arrow_right: Icons.ArrowRight,
  "arrow-up-right": Icons.ArrowUpRight,
  "corner-down-right": Icons.CornerDownRight,
  "git-branch": Icons.GitBranch,
  "list-ordered": Icons.ListOrdered,
  layers: Icons.Layers,
  workflow: Icons.Workflow,
  milestone: Icons.Milestone,

  // Emphasis and judgement
  "alert-triangle": Icons.AlertTriangle,
  "alert-octagon": Icons.AlertOctagon,
  info: Icons.Info,
  lightbulb: Icons.Lightbulb,
  star: Icons.Star,
  sparkles: Icons.Sparkles,
  heart: Icons.Heart,
  zap: Icons.Zap,
  flame: Icons.Flame,
  shield: Icons.Shield,
  "shield-alert": Icons.ShieldAlert,
  scale: Icons.Scale,
  gavel: Icons.Gavel,

  // Measurement and evidence
  target: Icons.Target,
  "trending-up": Icons.TrendingUp,
  "trending-down": Icons.TrendingDown,
  activity: Icons.Activity,
  gauge: Icons.Gauge,
  "chart-pie": Icons.PieChart,
  sigma: Icons.Sigma,
  percent: Icons.Percent,
  "clipboard-check": Icons.ClipboardCheck,
  microscope: Icons.Microscope,
  flask: Icons.FlaskConical,
  "test-tube": Icons.TestTube,

  // People, place and time
  users: Icons.Users,
  "user-check": Icons.UserCheck,
  handshake: Icons.Handshake,
  "message-circle": Icons.MessageCircle,
  megaphone: Icons.Megaphone,
  clock: Icons.Clock,
  calendar: Icons.Calendar,
  hourglass: Icons.Hourglass,
  "map-pin": Icons.MapPin,
  compass: Icons.Compass,
  globe: Icons.Globe,
  route: Icons.Route,

  // Clinical and life sciences
  stethoscope: Icons.Stethoscope,
  "heart-pulse": Icons.HeartPulse,
  brain: Icons.Brain,
  dna: Icons.Dna,
  pill: Icons.Pill,
  syringe: Icons.Syringe,
  ambulance: Icons.Ambulance,
  bandage: Icons.Bandage,
  thermometer: Icons.Thermometer,

  // Teaching, reference and craft
  "book-open": Icons.BookOpen,
  "graduation-cap": Icons.GraduationCap,
  quote: Icons.Quote,
  "pen-line": Icons.PenLine,
  search: Icons.Search,
  key: Icons.KeyRound,
  puzzle: Icons.Puzzle,
  wrench: Icons.Wrench,
  cpu: Icons.Cpu,
  database: Icons.Database,
  lock: Icons.Lock,
  eye: Icons.Eye,
};

const VideoIcon = Icons.Video;
const PlaceholderImageIcon = Icons.ImageIcon;

export function iconFor(name: string) {
  return ICONS[name] ?? ICONS[DEFAULT_ICON];
}

/**
 * Stable wrapper for the curated icon set.
 *
 * `createElement` rather than JSX because the component reference is looked up
 * from the module-level registry at render time. The references themselves are
 * stable; JSX with a locally-bound capitalised identifier just looks like a
 * dynamically created component to static analysis.
 */
function StageIcon({
  name,
  className,
  style,
  strokeWidth,
}: {
  name: string;
  className?: string;
  style?: React.CSSProperties;
  strokeWidth?: number;
}) {
  return createElement(iconFor(name), { className, style, strokeWidth });
}

/**
 * An icon by the same hand as the drawings.
 *
 * A Lucide glyph on its own is an interface icon: precise, weightless, the
 * mark a toolbar makes. Every take-home, action step and explainer card
 * leads with one, so a generated deck was led by toolbar icons. This puts a
 * wash behind the glyph — a closed organic form in the icon's own colour at
 * the drawings' tint, bent by the same kind of hand that bends a drawing's
 * wash, and seeded from the icon's name so the same icon always sits on
 * the same shape — and the icon reads as a mark somebody made for this
 * card rather than one it was issued.
 *
 * The glyph itself is not bent: at card sizes a displacement is a blur, and
 * a wash behind a clean line is exactly how an illustrated icon is made.
 */
function HandIcon({
  name,
  color,
  size,
  strokeWidth,
}: {
  name: string;
  color: string;
  /** The glyph's side, in CSS pixels. The wash fills the same box. */
  size: number;
  strokeWidth?: number;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const filterId = `iconwash-${uid}`;
  // The wash is drawn on a 100-unit box and scaled to the icon: the blob
  // recipe wanders its radius in the name, so `heart` is always the same
  // shape behind every heart in the deck. It fills the icon's own box and
  // sits a little down and to the right in it, like a drawing's wash — and
  // stays inside it, because a mark that paints past its box is what the
  // composition sheet's overflow scan reports as text cut off.
  return (
    <span
      data-hand-icon={name}
      style={{
        position: "relative",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: `${size}px`,
        height: `${size}px`,
        flexShrink: 0,
        color,
      }}
    >
      <svg
        aria-hidden
        viewBox="0 0 100 100"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }}
      >
        <defs>
          <filter id={filterId} x="-20%" y="-20%" width="140%" height="140%">
            <feTurbulence type="fractalNoise" baseFrequency={0.03} numOctaves={1} seed={11} />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale={handWobble(100) * 5}
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
        <path
          data-icon-wash
          d={blobPath(53, 54, 45, 43, name)}
          fill="currentColor"
          fillOpacity={0.14}
          filter={`url(#${filterId})`}
        />
      </svg>
      <StageIcon
        name={name}
        strokeWidth={strokeWidth}
        style={{ width: "100%", height: "100%", position: "relative" }}
      />
    </span>
  );
}

// Re-exported so existing importers keep working; the list itself is
// `@/lib/schema/icons`, which the generation schema also reads.
export { ICON_NAMES };

function fontFamily(
  style: TextStyle | undefined,
  theme: PresentationTheme,
  fallback: "display" | "sans" | "mono" = "sans",
) {
  const family = style?.family ?? fallback;
  return theme.fonts[family];
}

function textCss(
  style: TextStyle,
  theme: PresentationTheme,
  basePx: number,
  fallbackFamily: "display" | "sans" | "mono" = "sans",
  /** Pre-computed size that already accounts for the element's box. */
  fittedPx?: number,
): React.CSSProperties {
  return {
    fontSize: `${fittedPx ?? basePx * style.size}px`,
    fontWeight: style.weight,
    fontStyle: style.italic ? "italic" : "normal",
    textDecoration: style.underline ? "underline" : "none",
    textTransform: style.uppercase ? "uppercase" : "none",
    textAlign: style.align,
    lineHeight: style.lineHeight,
    letterSpacing: `${style.letterSpacing}em`,
    color: resolveColor(style.color, theme, "ink"),
    fontFamily: fontFamily(style, theme, fallbackFamily),
    display: "flex",
    flexDirection: "column",
    justifyContent:
      style.valign === "middle" ? "center" : style.valign === "bottom" ? "flex-end" : "flex-start",
    height: "100%",
    width: "100%",
    overflowWrap: "break-word",
    wordBreak: "break-word",
  };
}

function plainOf(runs: RichText): string {
  return runs.map((r) => r.text).join("");
}

/**
 * Past this many words a heading is a paragraph, and a paragraph arriving a
 * word at a time is read as a delay rather than as emphasis.
 */
const KINETIC_WORDS_MAX = 14;

/**
 * A heading that arrives a word at a time.
 *
 * Each word rises into place a beat after the one before, so a claim is
 * read in the order it was written rather than taken in as a block — the
 * typographic equivalent of a sentence being said. Inline-block spans, so
 * lines still break at the spaces and the auto-fit above, which measured
 * the plain text, still holds. The rise is small and the stagger short: a
 * ten-word heading is complete in under a second. Long headings, and any
 * run with styling, arrive whole. Under reduced motion the words are simply
 * there.
 */
function KineticWords({ text }: { text: string }) {
  const words = text.split(/(\s+)/);
  const count = words.filter((w) => w.trim().length > 0).length;
  if (count === 0 || count > KINETIC_WORDS_MAX) return <>{text}</>;
  let index = 0;
  return (
    <>
      {words.map((word, i) => {
        if (word.trim().length === 0) return word;
        const style = { "--kt-i": index++ } as React.CSSProperties;
        return (
          <span key={i} className="kt-word" style={style}>
            {word}
          </span>
        );
      })}
    </>
  );
}

/** One run with nothing on it: the only shape a counted figure has. */
function isPlainRun(runs: RichText): boolean {
  if (runs.length !== 1) return false;
  const run = runs[0];
  return !run.bold && !run.italic && !run.underline && !run.href && !run.code && !run.color;
}

/**
 * A figure that climbs to its value when its scene is performed.
 *
 * The final text is what React renders, so the auto-fit above measured the
 * real number and the editor, a thumbnail and a paused recording all show it.
 * The climb is written straight to the text node from a frame loop: sixty
 * renders a second through React for one changing number is the cost this
 * avoids. Tabular numerals, so the digits change under a still layout. A
 * reduced-motion preference shows the number as it is.
 */
function FigureText({ text, perform }: { text: string; perform: boolean }) {
  const spec = useMemo(() => parseFigure(text), [text]);
  const ref = useRef<HTMLSpanElement>(null);
  const reduced = useReducedMotion();

  useEffect(() => {
    const node = ref.current;
    if (!perform || !spec || reduced || !node) return;
    let frame = 0;
    let startedAt = 0;
    node.textContent = formatFigure(spec, 0);
    const tick = (now: number) => {
      if (startedAt === 0) startedAt = now;
      const t = Math.min(1, (now - startedAt) / COUNT_MS);
      node.textContent = formatFigure(spec, figureAt(spec, t));
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      // Whatever interrupted the climb, the number left behind is the real one.
      node.textContent = formatFigure(spec, spec.value);
    };
  }, [perform, spec, reduced]);

  if (!spec) return <>{text}</>;
  return (
    <>
      {spec.prefix}
      {/* Keyed on the text: the climb writes the span's text node directly,
          which detaches the one React rendered, so a changed figure must get
          a fresh span rather than an update to a node nobody can see. */}
      <span key={text} ref={ref} style={{ fontVariantNumeric: "tabular-nums" }}>
        {formatFigure(spec, spec.value)}
      </span>
      {spec.suffix}
    </>
  );
}

/**
 * The phrase that matters, underlined by hand — see `lib/present/hand-mark`.
 *
 * Rendered inside the text's block, over it. The strokes are measured from
 * the DOM after layout: one per line fragment the marked run occupies, in the
 * host's own pixels (the stage may be scaled by a transform, so screen rects
 * are divided back by the host's scale). Written straight to the SVG from an
 * effect, as `FigureText` writes its number, and re-measured on resize, when
 * the words or their face change, and once the fonts are in. While the scene
 * performs each stroke sketches on the
 * drawings' clock after the words have arrived; otherwise — the editor, a
 * thumbnail, reduced motion — the mark is simply there.
 */
function HandMarks({ perform }: { perform: boolean }) {
  const ref = useRef<SVGSVGElement>(null);
  const uid = useId().replace(/[^a-zA-Z0-9]/g, "");
  const reduced = useReducedMotion();

  useEffect(() => {
    const svg = ref.current;
    const host = svg?.parentElement;
    if (!svg || !host) return;
    const sketch = perform && !reduced;

    const draw = () => {
      const group = svg.querySelector("g");
      const hand = svg.querySelector("feDisplacementMap");
      if (!group) return;
      const box = host.getBoundingClientRect();
      const scale = host.offsetWidth > 0 ? box.width / host.offsetWidth : 1;
      if (!(scale > 0)) return;
      group.replaceChildren();
      let index = 0;
      for (const mark of host.querySelectorAll<HTMLElement>("[data-hand-mark]")) {
        const size = parseFloat(getComputedStyle(mark).fontSize) || 16;
        hand?.setAttribute("scale", String(size * 0.12));
        for (const rect of mark.getClientRects()) {
          if (!(rect.width > 0)) continue;
          const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
          path.setAttribute(
            "d",
            underlinePath(
              {
                x: (rect.left - box.left) / scale,
                y: (rect.bottom - box.top) / scale,
                width: rect.width / scale,
              },
              size,
              index,
            ),
          );
          path.setAttribute("stroke-width", String(size * MARK_WEIGHT));
          path.setAttribute("class", sketch ? "dp-path dp-drawn" : "dp-path");
          group.append(path);
          if (sketch) {
            // Measured in the DOM, as a drawing's strokes are; the classes
            // above sketch it from its full length to nothing.
            path.style.setProperty("--dp-len", String(path.getTotalLength()));
            path.style.setProperty("--dp-dur", `${MARK_DURATION_S}s`);
            path.style.setProperty("--dp-del", `${MARK_DELAY_S + index * MARK_STAGGER_S}s`);
          }
          index += 1;
        }
      }
    };

    draw();
    const resized = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(() => draw());
    resized?.observe(host);
    // The words themselves: an author editing the phrase in place, or a
    // theme changing the face, moves the lines under the mark without
    // resizing the host. Watched on the text's own span and on the host's
    // attributes — never on the SVG, which `draw` itself writes.
    const words = host.querySelector(":scope > span");
    const reworded =
      typeof MutationObserver === "undefined" ? null : new MutationObserver(() => draw());
    if (words) {
      reworded?.observe(words, {
        subtree: true,
        characterData: true,
        childList: true,
        attributes: true,
      });
    }
    reworded?.observe(host, { attributes: true, attributeFilter: ["style", "class"] });
    document.fonts?.ready.then(draw).catch(() => {});
    return () => {
      resized?.disconnect();
      reworded?.disconnect();
    };
  }, [perform, reduced]);

  return (
    <svg
      ref={ref}
      className="hm"
      aria-hidden
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        width: "100%",
        height: "100%",
        overflow: "visible",
        pointerEvents: "none",
      }}
    >
      <defs>
        <filter
          id={`mark-${uid}`}
          filterUnits="userSpaceOnUse"
          x="-5%"
          y="-5%"
          width="110%"
          height="110%"
        >
          <feTurbulence
            type="fractalNoise"
            baseFrequency="0.02"
            numOctaves="2"
            seed="11"
            result="noise"
          />
          <feDisplacementMap
            in="SourceGraphic"
            in2="noise"
            scale="3"
            xChannelSelector="R"
            yChannelSelector="G"
          />
        </filter>
      </defs>
      <g
        filter={`url(#mark-${uid})`}
        fill="none"
        stroke="var(--stage-accent)"
        strokeLinecap="round"
        opacity={0.9}
      />
    </svg>
  );
}

function Runs({ runs, theme }: { runs: RichText; theme: PresentationTheme }) {
  return (
    <>
      {runs.map((run, i) => {
        const style: React.CSSProperties = {
          fontWeight: run.bold ? 700 : undefined,
          fontStyle: run.italic ? "italic" : undefined,
          textDecoration: run.underline ? "underline" : undefined,
          color: run.color ? resolveColor(run.color, theme, "ink") : undefined,
          fontFamily: run.code ? theme.fonts.mono : undefined,
          background: run.code ? theme.tokens.surface : undefined,
          padding: run.code ? "0.1em 0.3em" : undefined,
          borderRadius: run.code ? "0.2em" : undefined,
        };

        // Preserve authored line breaks without introducing raw HTML.
        const text = run.text.split("\n").map((line, li, arr) => (
          <span key={li}>
            {line}
            {li < arr.length - 1 && <br />}
          </span>
        ));

        if (run.href) {
          return (
            <a
              key={i}
              href={run.href}
              target="_blank"
              rel="noreferrer noopener"
              style={{ ...style, textDecoration: "underline", color: theme.tokens.accent }}
            >
              {text}
            </a>
          );
        }
        return (
          <span key={i} style={style} data-hand-mark={isAccentRun(run) ? "" : undefined}>
            {text}
          </span>
        );
      })}
    </>
  );
}

export const ElementView = memo(function ElementView({
  element,
  theme,
  stageWidth,
  stageHeight,
  perform = false,
}: Props) {
  const rem = stageRem(stageWidth);
  const scale = theme.scale;
  // One grade filter per picture, named so two pictures on a scene keep
  // their own and a thumbnail never borrows the stage's.
  const gradeId = `grade-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;

  // The element's box in stage pixels, used to shrink over-long text so it
  // never spills onto whatever sits below it.
  const boxWidth = (element.frame.w / 100) * stageWidth;
  const boxHeight = stageHeight ? (element.frame.h / 100) * stageHeight : 0;

  const fit = (
    text: string,
    desired: number,
    style: TextStyle,
    family: "display" | "sans" | "mono",
    lines?: number,
    /**
     * The share of the element's box this text actually gets, where it is not
     * all of it — a callout spends its own height on padding, an icon and a
     * title before its body starts.
     */
    share: { width: number; height: number } = { width: 1, height: 1 },
  ) => {
    if (!stageHeight) return desired;
    const metrics = textMetrics(text);
    return fitTextSize({
      ...metrics,
      boxWidth: boxWidth * share.width,
      boxHeight: boxHeight * share.height,
      desiredSize: desired,
      lineHeight: style.lineHeight,
      family: style.family ?? family,
      lines,
    });
  };

  switch (element.type) {
    case "heading": {
      const base =
        (element.level === 1 ? scale.h1 : element.level === 2 ? scale.h2 : scale.h3) * rem;
      const Tag = `h${element.level}` as const satisfies "h1" | "h2" | "h3";
      const fitted = fit(
        plainOf(element.content),
        base * element.style.size,
        element.style,
        "display",
      );
      return (
        <Tag
          style={{
            ...textCss(element.style, theme, base, "display", fitted),
            position: "relative",
          }}
        >
          <span>
            {perform && isPlainRun(element.content) ? (
              <KineticWords text={plainOf(element.content)} />
            ) : (
              <Runs runs={element.content} theme={theme} />
            )}
          </span>
          {element.content.some(isAccentRun) && <HandMarks perform={perform} />}
        </Tag>
      );
    }

    case "text":
      return (
        <div
          style={{
            ...textCss(
              element.style,
              theme,
              scale.h2 * rem,
              "sans",
              fit(
                plainOf(element.content),
                scale.h2 * rem * element.style.size,
                element.style,
                "sans",
              ),
            ),
            position: "relative",
          }}
        >
          <span>
            {element.role === "figure" && isPlainRun(element.content) ? (
              <FigureText text={plainOf(element.content)} perform={perform} />
            ) : (
              <Runs runs={element.content} theme={theme} />
            )}
          </span>
          {element.content.some(isAccentRun) && <HandMarks perform={perform} />}
        </div>
      );

    case "quote":
      return (
        <figure style={{ height: "100%", width: "100%", margin: 0 }}>
          <blockquote
            style={{
              ...textCss(
                element.style,
                theme,
                scale.h2 * rem,
                "display",
                fit(
                  plainOf(element.content),
                  scale.h2 * rem * element.style.size,
                  element.style,
                  "display",
                ),
              ),
              height: element.attribution ? "auto" : "100%",
              margin: 0,
            }}
          >
            <span>
              <span style={{ color: theme.tokens.accent }}>“</span>
              <Runs runs={element.content} theme={theme} />
              <span style={{ color: theme.tokens.accent }}>”</span>
            </span>
          </blockquote>
          {element.attribution && (
            <figcaption
              style={{
                marginTop: `${rem * 1.2}px`,
                fontSize: `${scale.caption * rem * 1.1}px`,
                color: theme.tokens.inkMuted,
                textAlign: element.style.align,
                fontFamily: theme.fonts.sans,
                letterSpacing: "0.02em",
              }}
            >
              — {element.attribution}
            </figcaption>
          )}
        </figure>
      );

    case "list": {
      /*
       * Measured per item rather than estimated for the list.
       *
       * The estimate this replaces budgeted `items + items / 2` lines, so
       * three bullets of a sentence each were allowed four lines when they
       * wrap to eight — and it spent nothing on the bullet, the space after
       * it, or the gaps between items. A two-column scene of three real
       * bullets asked for 656px of a 558px box and the last line was simply
       * cut off on the projector.
       */
      const desired = scale.h2 * rem * element.style.size;
      const base = stageHeight
        ? fitListSize({
            items: element.items.map((item) => textMetrics(plainOf(item))),
            boxWidth,
            boxHeight,
            desiredSize: desired,
            lineHeight: element.style.lineHeight,
            family: element.style.family ?? "sans",
            ordered: element.ordered,
          })
        : desired;
      const Tag = element.ordered ? "ol" : "ul";
      return (
        <Tag
          style={{
            ...textCss(element.style, theme, scale.h2 * rem, "sans", base),
            listStyle: "none",
            margin: 0,
            padding: 0,
            gap: `${base * LIST_ITEM_GAP_EMS}px`,
          }}
        >
          {element.items.map((item, i) => (
            <li
              key={i}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: `${base * LIST_MARKER_GAP_EMS}px`,
                textAlign: element.style.align,
              }}
            >
              <span
                aria-hidden
                style={{
                  flexShrink: 0,
                  marginTop: element.ordered ? 0 : `${base * 0.42}px`,
                  width: element.ordered ? "auto" : `${base * LIST_MARKER_WIDTH_EMS}px`,
                  height: element.ordered ? "auto" : `${base * LIST_MARKER_WIDTH_EMS}px`,
                  borderRadius: "50%",
                  background: element.ordered ? "transparent" : theme.tokens.accent,
                  color: theme.tokens.accent,
                  fontSize: element.ordered ? `${base * 0.8}px` : undefined,
                  fontWeight: 600,
                  fontFamily: theme.fonts.sans,
                  minWidth: element.ordered
                    ? `${base * LIST_ORDERED_MARKER_WIDTH_EMS}px`
                    : undefined,
                }}
              >
                {element.ordered ? `${i + 1}.` : ""}
              </span>
              <span style={{ flex: 1 }}>
                <Runs runs={item} theme={theme} />
              </span>
            </li>
          ))}
        </Tag>
      );
    }

    case "image": {
      // A soft edge is rounded generously and feathered on all four sides by
      // a mask, so the picture pools into the surface instead of ending at a
      // line. Two gradients intersected rather than one radial: a radial
      // feather leaves a full-bleed photograph as an oval, and a picture's
      // corners are the part of it that should go quietly, not its middle.
      // Never on a picture that is the whole stage: feathering a veil showed
      // the title scene through its rim.
      const soft = element.edge === "soft" && !coversStage(element.frame);
      const radiusPx = Math.max(element.radius, soft ? 2.4 : 0) * rem;
      const matrix = gradeMatrix(element.grade, theme.tokens.canvas, theme.tokens.accent);
      const feather =
        "linear-gradient(to right, transparent, #000 10%, #000 90%, transparent), linear-gradient(to bottom, transparent, #000 10%, #000 90%, transparent)";
      return (
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
            overflow: "hidden",
            borderRadius: `${radiusPx}px`,
            maskImage: soft ? feather : undefined,
            maskComposite: soft ? "intersect" : undefined,
            WebkitMaskImage: soft ? feather : undefined,
            WebkitMaskComposite: soft ? "source-in" : undefined,
          }}
        >
          {element.url ? (
            /* Stage images are user uploads at arbitrary sizes rendered inside
               a CSS-transformed stage; next/image's layout system fights the
               transform, and the source is a signed private redirect that the
               optimiser cannot fetch. */
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={element.url}
              alt={element.alt}
              loading="lazy"
              decoding="async"
              draggable={false}
              data-grade={element.grade}
              style={{
                width: "100%",
                height: "100%",
                objectFit: element.fit,
                objectPosition: `${element.focalX * 100}% ${element.focalY * 100}%`,
                display: "block",
                filter: matrix ? `url(#${gradeId})` : undefined,
              }}
            />
          ) : (
            <ImagePlaceholder
              theme={theme}
              rem={rem}
              label={element.alt || "Image"}
              radiusPx={radiusPx}
            />
          )}
          {/* The grade, defined beside the picture it colours — see `GradeFilter`. */}
          {element.url && matrix && (
            <GradeFilter id={gradeId} grade={element.grade} theme={theme} />
          )}
          {/* A scrim darkens a photograph so a caption over it stays legible.
              With no photograph it is a dark rectangle over nothing — which on
              the world canvas reads as a slide sitting on the page. */}
          {element.scrim > 0 && element.url && (
            <div
              aria-hidden
              style={{
                position: "absolute",
                inset: 0,
                background: `linear-gradient(to top, rgba(0,0,0,${element.scrim}) 0%, rgba(0,0,0,${element.scrim * 0.55}) 45%, rgba(0,0,0,${element.scrim * 0.15}) 100%)`,
              }}
            />
          )}
        </div>
      );
    }

    case "video":
      return element.url ? (
        <video
          src={element.url}
          poster={element.poster || undefined}
          controls={element.controls}
          autoPlay={element.autoplay}
          loop={element.loop}
          muted={element.muted}
          playsInline
          preload="metadata"
          aria-label={element.alt || "Video"}
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover",
            borderRadius: `${element.radius * rem}px`,
            background: "#000",
          }}
        />
      ) : (
        <ImagePlaceholder theme={theme} rem={rem} label="Video" icon="video" />
      );

    case "audio":
      return (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: `${rem * 0.6}px`,
            width: "100%",
            height: "100%",
            padding: `${rem}px`,
            background: theme.tokens.surface,
            borderRadius: `${rem}px`,
          }}
        >
          {element.title && (
            <p
              style={{
                fontSize: `${scale.caption * rem * 1.2}px`,
                color: theme.tokens.ink,
                fontFamily: theme.fonts.sans,
                margin: 0,
              }}
            >
              {element.title}
            </p>
          )}
          {element.url ? (
            <audio
              src={element.url}
              controls
              autoPlay={element.autoplay}
              style={{ width: "100%" }}
            />
          ) : (
            <p
              style={{
                fontSize: `${scale.caption * rem}px`,
                color: theme.tokens.inkMuted,
                margin: 0,
              }}
            >
              No audio selected
            </p>
          )}
        </div>
      );

    case "shape": {
      const fill = element.fill ? resolveColor(element.fill, theme, "accent") : "transparent";
      const stroke = element.stroke ? resolveColor(element.stroke, theme, "line") : "transparent";
      const strokePx = element.strokeWidth * rem * 0.5;

      if (element.shape === "line") {
        return (
          <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center" }}>
            <div
              style={{
                width: "100%",
                height: `${Math.max(1, strokePx)}px`,
                background: stroke === "transparent" ? fill : stroke,
              }}
            />
          </div>
        );
      }
      if (element.shape === "triangle" || element.shape === "arrow") {
        const path =
          element.shape === "triangle"
            ? "50,4 96,96 4,96"
            : "4,38 62,38 62,10 96,50 62,90 62,62 4,62";
        return (
          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            style={{ width: "100%", height: "100%" }}
            aria-hidden
          >
            <polygon
              points={path}
              fill={fill}
              stroke={stroke}
              strokeWidth={element.strokeWidth}
              vectorEffect="non-scaling-stroke"
            />
          </svg>
        );
      }
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            background: fill,
            border: strokePx > 0 ? `${strokePx}px solid ${stroke}` : "none",
            borderRadius: element.shape === "ellipse" ? "50%" : `${element.radius * rem}px`,
          }}
        />
      );
    }

    case "divider":
      return (
        <div style={{ width: "100%", height: "100%", display: "flex", alignItems: "center" }}>
          <div
            style={{
              width: "100%",
              height: `${Math.max(1, element.thickness * rem * 0.5)}px`,
              background: element.color
                ? resolveColor(element.color, theme, "line")
                : theme.tokens.line,
            }}
          />
        </div>
      );

    case "icon": {
      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <HandIcon
            name={element.name}
            strokeWidth={element.strokeWidth}
            size={Math.min(boxWidth, boxHeight)}
            color={
              element.color ? resolveColor(element.color, theme, "accent") : theme.tokens.accent
            }
          />
        </div>
      );
    }

    case "callout": {
      const toneColor =
        element.tone === "accent"
          ? theme.tokens.accent
          : element.tone === "success"
            ? "#3FBF87"
            : element.tone === "warning"
              ? "#E5A13B"
              : element.tone === "danger"
                ? "#E2604F"
                : theme.tokens.inkMuted;

      // The open variant paints nothing behind itself. An icon set large, a
      // short rule in the tone colour, a title and a line — straight onto the
      // surface, so three of them in a row read as three ideas on one page
      // rather than three panels leaning against a wall.
      //
      // A wide, short box (the explainer's stacked points) lays the icon
      // beside the words rather than above them; a tall one (a three-up or a
      // call to action's steps) stacks them.
      const open = element.variant === "open";
      const row = open && boxWidth > boxHeight * 2;
      const iconPx = rem * (open ? 3.2 : 1.8);

      const icon = (
        <HandIcon
          name={element.icon}
          strokeWidth={open ? 1.6 : undefined}
          size={iconPx}
          color={toneColor}
        />
      );
      const rule = open && (
        <div
          aria-hidden
          style={{
            width: `${rem * 2.4}px`,
            height: `${rem * 0.18}px`,
            borderRadius: `${rem * 0.09}px`,
            background: toneColor,
            opacity: 0.7,
            flexShrink: 0,
          }}
        />
      );
      const words = (
        <>
          {element.title && (
            <p
              style={{
                margin: 0,
                fontSize: `${scale.h3 * rem * element.style.size * 0.9}px`,
                fontWeight: 600,
                color: theme.tokens.ink,
                fontFamily: open ? theme.fonts.display : theme.fonts.sans,
                lineHeight: 1.25,
              }}
            >
              {element.title}
            </p>
          )}
          <div
            style={{
              /**
               * Fitted, like every other text on the stage.
               *
               * A callout was the only text on the stage that was not: its
               * box clips, so a body longer than the card would lose its last
               * line with nothing on screen to say so.
               */
              fontSize: `${fit(
                plainOf(element.content),
                scale.body * rem * element.style.size,
                element.style,
                "sans",
                undefined,
                row
                  ? { width: 0.74, height: 0.6 }
                  : open
                    ? { width: 0.98, height: 0.4 }
                    : { width: 0.84, height: 0.46 },
              )}px`,
              color: theme.tokens.inkMuted,
              fontFamily: theme.fonts.sans,
              lineHeight: element.style.lineHeight,
              flex: 1,
              minHeight: 0,
              overflow: "hidden",
            }}
          >
            <Runs runs={element.content} theme={theme} />
          </div>
        </>
      );

      if (row) {
        return (
          <div
            style={{
              width: "100%",
              height: "100%",
              display: "flex",
              flexDirection: "row",
              alignItems: "flex-start",
              gap: `${rem * 1.2}px`,
              padding: `${rem * 0.3}px 0`,
            }}
          >
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                gap: `${rem * 0.5}px`,
                flexShrink: 0,
              }}
            >
              {icon}
              {rule}
            </div>
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: `${rem * 0.3}px`,
                flex: 1,
                minWidth: 0,
                minHeight: 0,
              }}
            >
              {words}
            </div>
          </div>
        );
      }

      return (
        <div
          style={{
            width: "100%",
            height: "100%",
            display: "flex",
            flexDirection: "column",
            gap: `${rem * (open ? 0.55 : 0.7)}px`,
            padding: open ? `${rem * 0.4}px 0` : `${rem * 1.4}px`,
            background: open ? "transparent" : theme.tokens.surface,
            borderRadius: open ? 0 : `${rem * 0.8}px`,
            borderTop: open ? "none" : `${rem * 0.16}px solid ${toneColor}`,
          }}
        >
          {icon}
          {rule}
          {words}
        </div>
      );
    }

    case "code":
      return (
        <pre
          style={{
            margin: 0,
            width: "100%",
            height: "100%",
            overflow: "hidden",
            padding: `${rem * 1.4}px`,
            background: theme.tokens.surface,
            borderRadius: `${rem * 0.7}px`,
            fontFamily: theme.fonts.mono,
            fontSize: `${scale.body * rem * element.style.size}px`,
            lineHeight: element.style.lineHeight,
            color: theme.tokens.ink,
            tabSize: 2,
          }}
        >
          <code>
            {element.showLineNumbers
              ? element.code.split("\n").map((line, i) => (
                  <span key={i} style={{ display: "block" }}>
                    <span
                      style={{
                        color: theme.tokens.inkMuted,
                        userSelect: "none",
                        marginRight: `${rem}px`,
                      }}
                    >
                      {String(i + 1).padStart(2, " ")}
                    </span>
                    {line}
                  </span>
                ))
              : element.code}
          </code>
        </pre>
      );

    case "chart":
      // Drawn by the same hand as the diagrams: compiled to strokes and
      // labels at render time and sketched complete here. The stage swaps in
      // the step-driven version while presenting, as it does for a drawing.
      return (
        <DrawnPicture
          element={chartDrawing(element)}
          step={Number.POSITIVE_INFINITY}
          fontFamily={theme.fonts.hand}
        />
      );

    case "drawing":
      // Complete, not animated: this path serves the editor canvas, thumbnails
      // and previews, where the picture is being looked at rather than
      // performed. The stage swaps in the step-driven version while presenting.
      return (
        <DrawnPicture
          element={element}
          step={Number.POSITIVE_INFINITY}
          fontFamily={theme.fonts.hand}
        />
      );

    case "embed":
      return (
        <iframe
          src={element.url}
          title={element.title || "Embedded content"}
          loading="lazy"
          // Third-party content may render and run scripts on its own origin;
          // it can never navigate us. An embed pointing back at this
          // deployment is framed without `allow-same-origin`, because that
          // pairing would hand it this origin — see `embedSandbox`.
          sandbox={embedSandbox(element.url, process.env.NEXT_PUBLIC_SITE_URL)}
          referrerPolicy="no-referrer"
          allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; fullscreen"
          style={{
            width: "100%",
            height: "100%",
            border: "none",
            borderRadius: `${element.radius * rem}px`,
            background: theme.tokens.surface,
          }}
        />
      );

    default:
      return null;
  }
});

function ImagePlaceholder({
  theme,
  rem,
  label,
  icon = "image",
  radiusPx,
}: {
  theme: PresentationTheme;
  rem: number;
  label: string;
  icon?: "image" | "video";
  /** The corner of the frame the placeholder stands in, so the outline matches. */
  radiusPx?: number;
}) {
  const Icon = icon === "video" ? VideoIcon : PlaceholderImageIcon;
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: `${rem * 0.6}px`,
        // No fill. On the world canvas a filled rectangle is the single
        // strongest "this is a slide" cue there is, and an empty picture frame
        // is one of the few things every scene starts with. The dashed outline
        // says "a picture goes here" without putting a block on the surface.
        background: "transparent",
        border: `${Math.max(1, rem * 0.08)}px dashed ${theme.tokens.line}`,
        borderRadius: `${radiusPx ?? rem * 0.6}px`,
        color: theme.tokens.inkMuted,
      }}
    >
      <Icon style={{ width: `${rem * 2.2}px`, height: `${rem * 2.2}px` }} />
      <span style={{ fontSize: `${rem * 0.95}px`, fontFamily: theme.fonts.sans }}>{label}</span>
    </div>
  );
}

/** Small dependency-free chart renderer covering the four MVP chart types. */
