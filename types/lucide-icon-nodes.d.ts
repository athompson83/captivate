/**
 * The path data behind each Lucide icon.
 *
 * `lucide-react` ships every icon as its own module exporting the React
 * component and, beside it, the `__iconNode` the component draws — an array
 * of SVG primitives in a 24×24 box. The diagram compiler reads that data to
 * place a symbol as strokes in a drawing, which the component cannot do.
 * The package publishes no types for the per-icon modules, so this names
 * what they export.
 */
declare module "lucide-react/dist/esm/icons/*.mjs" {
  export const __iconNode: [elementName: string, attrs: Record<string, string>][];
}
