/**
 * Colour interpolation in OKLab.
 *
 * Blending two colours in sRGB drags the midpoint through grey — a deep blue
 * mixed halfway to amber gives mud, which is exactly what a camera flying
 * between two regions of a presentation would show. OKLab is perceptually
 * uniform, so the midpoint looks like a midpoint.
 *
 * Theme tokens are hex, so hex is what goes in; `oklab()` is what comes out,
 * because the browser can render it directly and the round trip back through
 * sRGB would clip colours that are perfectly displayable.
 */

export interface Oklab {
  L: number;
  a: number;
  b: number;
}

const HEX = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i;

/** Parses `#rgb` or `#rrggbb` to sRGB components in 0..1. Black on nonsense. */
export function parseHex(hex: string): { r: number; g: number; b: number } {
  const match = HEX.exec(hex.trim());
  if (!match) return { r: 0, g: 0, b: 0 };

  const digits = match[1].length === 3 ? [...match[1]].map((c) => c + c).join("") : match[1];
  return {
    r: parseInt(digits.slice(0, 2), 16) / 255,
    g: parseInt(digits.slice(2, 4), 16) / 255,
    b: parseInt(digits.slice(4, 6), 16) / 255,
  };
}

function linearize(channel: number): number {
  return channel <= 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** sRGB to OKLab, per Björn Ottosson's derivation. */
export function toOklab(hex: string): Oklab {
  const { r, g, b } = parseHex(hex);
  const lr = linearize(r);
  const lg = linearize(g);
  const lb = linearize(b);

  const l = Math.cbrt(0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb);
  const m = Math.cbrt(0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb);
  const s = Math.cbrt(0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb);

  return {
    L: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    a: 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    b: 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  };
}

/**
 * WCAG relative luminance, and the contrast ratio between two colours.
 *
 * Separate from OKLab on purpose: OKLab lightness is perceptually uniform,
 * which is what makes it right for *blending*, but accessibility thresholds are
 * defined against this specific luminance formula and nothing else. Using L as
 * a proxy would produce a number that looks like a contrast ratio and is not
 * one, which is worse than not reporting it.
 */
export function relativeLuminance(hex: string): number {
  const { r, g, b } = parseHex(hex);
  return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
}

/** 1 for identical colours, 21 for black on white. */
export function contrastRatio(a: string, b: string): number {
  const la = relativeLuminance(a);
  const lb = relativeLuminance(b);
  const lighter = Math.max(la, lb);
  const darker = Math.min(la, lb);
  return (lighter + 0.05) / (darker + 0.05);
}

export function mixOklab(from: Oklab, to: Oklab, t: number): Oklab {
  const clamped = Math.min(1, Math.max(0, t));
  return {
    L: from.L + (to.L - from.L) * clamped,
    a: from.a + (to.a - from.a) * clamped,
    b: from.b + (to.b - from.b) * clamped,
  };
}

/** Weighted average of several colours. Weights need not sum to one. */
export function blendOklab(entries: { color: Oklab; weight: number }[]): Oklab {
  let total = 0;
  let L = 0;
  let a = 0;
  let b = 0;

  for (const entry of entries) {
    if (entry.weight <= 0) continue;
    total += entry.weight;
    L += entry.color.L * entry.weight;
    a += entry.color.a * entry.weight;
    b += entry.color.b * entry.weight;
  }

  if (total === 0) return { L: 0, a: 0, b: 0 };
  return { L: L / total, a: a / total, b: b / total };
}

/** A CSS colour. `alpha` below 1 emits the slash form. */
export function oklabCss(color: Oklab, alpha = 1): string {
  const L = round(Math.min(1, Math.max(0, color.L)));
  const a = round(color.a);
  const b = round(color.b);
  return alpha >= 1 ? `oklab(${L} ${a} ${b})` : `oklab(${L} ${a} ${b} / ${round(alpha)})`;
}

function round(value: number): number {
  return Math.round(value * 10000) / 10000;
}
