import { GRAIN, gradeMatrix, matrixValues, type ImageGrade } from "@/lib/present/grade";
import type { PresentationTheme } from "@/lib/schema/theme";

/**
 * The grade: the deck's own colour laid into a photograph's pixels — its own
 * alpha, so a contained picture's gutters and a PNG's transparent parts
 * stay untouched — and grain composited inside the same alpha. One filter,
 * defined beside the picture it colours and referenced by `url(#id)` from
 * its `filter`. Nothing when the grade is `none`: a picture left as shot
 * carries no filter at all.
 *
 * Shared by a scene's picture and the picture behind the whole show, so the
 * room is coloured by exactly the hand that colours the pictures in it.
 */
export function GradeFilter({
  id,
  grade,
  theme,
}: {
  id: string;
  grade: ImageGrade;
  theme: PresentationTheme;
}) {
  const matrix = gradeMatrix(grade, theme.tokens.canvas, theme.tokens.accent);
  if (!matrix) return null;
  return (
    <svg width={0} height={0} aria-hidden style={{ position: "absolute" }}>
      <filter id={id} colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={matrixValues(matrix)} result="graded" />
        <feTurbulence
          type="fractalNoise"
          baseFrequency={0.9}
          numOctaves={2}
          stitchTiles="stitch"
          result="noise"
        />
        <feColorMatrix
          in="noise"
          type="matrix"
          values={`0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 0 0.5  0 0 0 ${GRAIN[grade]} 0`}
          result="grain"
        />
        <feComposite in="grain" in2="SourceGraphic" operator="in" result="grainIn" />
        <feBlend in="grainIn" in2="graded" mode="overlay" />
      </filter>
    </svg>
  );
}
