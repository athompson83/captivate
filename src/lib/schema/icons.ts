/**
 * The icons a scene may name.
 *
 * A plain list, in a plain module, for one reason: two very different things
 * need it and neither can import the other. The renderer maps each name to a
 * component (`element-view.tsx`, a client module full of React), and the
 * generation schema needs the same names as a Zod enum so a model can only ask
 * for an icon that exists — and a `"use server"` or server-only module cannot
 * pull in a client component tree to find out what they are.
 *
 * Grouped by what an icon is *for* rather than alphabetically, because that is
 * how the list is read when choosing one, and because the model is shown these
 * names and a group it can reason about produces better choices than a
 * shuffled bag.
 *
 * Adding a name here without adding its component makes it resolve to a plain
 * circle, silently — which is the failure the whole set exists to avoid. There
 * is a test that fails instead.
 */
export const ICON_NAMES = [
  // Structure and sequence: the shape of an argument.
  "circle",
  "check",
  "check-circle",
  "x",
  "arrow_right",
  "arrow-up-right",
  "corner-down-right",
  "git-branch",
  "list-ordered",
  "layers",
  "workflow",
  "milestone",

  // Emphasis and judgement: what the audience should feel about a point.
  "alert-triangle",
  "alert-octagon",
  "info",
  "lightbulb",
  "star",
  "sparkles",
  "heart",
  "zap",
  "flame",
  "shield",
  "shield-alert",
  "scale",
  "gavel",

  // Measurement and evidence.
  "target",
  "trending-up",
  "trending-down",
  "activity",
  "gauge",
  "chart-pie",
  "sigma",
  "percent",
  "clipboard-check",
  "microscope",
  "flask",
  "test-tube",

  // People, place and time.
  "users",
  "user-check",
  "handshake",
  "message-circle",
  "megaphone",
  "clock",
  "calendar",
  "hourglass",
  "map-pin",
  "compass",
  "globe",
  "route",

  // Clinical and life sciences, which is a great deal of what this tool is for.
  "stethoscope",
  "heart-pulse",
  "brain",
  "dna",
  "pill",
  "syringe",
  "ambulance",
  "bandage",
  "thermometer",

  // Teaching, reference and craft.
  "book-open",
  "graduation-cap",
  "quote",
  "pen-line",
  "search",
  "key",
  "puzzle",
  "wrench",
  "cpu",
  "database",
  "lock",
  "eye",
] as const;

export type IconName = (typeof ICON_NAMES)[number];

/** The one every unknown name falls back to, named once rather than inline. */
export const DEFAULT_ICON: IconName = "circle";
