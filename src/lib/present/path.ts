/**
 * The route drawn between waypoints when the camera pulls back.
 *
 * Straight segments make a journey look like a flowchart. A Catmull-Rom spline
 * through the waypoints reads as a path someone walks, which is the point — the
 * audience should see a route through a territory, not a wiring diagram.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * An SVG path through `points`, smoothed with a centripetal-ish Catmull-Rom
 * conversion to cubic béziers.
 *
 * `tension` at 0 gives a straight polyline; the default keeps the curve tight
 * enough that it never wanders somewhere the camera does not actually go.
 */
export function smoothPath(points: Point[], tension = 0.22): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;

  const segments: string[] = [`M ${points[0].x} ${points[0].y}`];

  for (let i = 0; i < points.length - 1; i += 1) {
    // Clamp at the ends so the curve starts and finishes at a real waypoint
    // rather than overshooting into empty canvas.
    const previous = points[i - 1] ?? points[i];
    const current = points[i];
    const next = points[i + 1];
    const after = points[i + 2] ?? next;

    const c1 = {
      x: current.x + (next.x - previous.x) * tension,
      y: current.y + (next.y - previous.y) * tension,
    };
    const c2 = {
      x: next.x - (after.x - current.x) * tension,
      y: next.y - (after.y - current.y) * tension,
    };

    segments.push(`C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${next.x} ${next.y}`);
  }

  return segments.join(" ");
}

/** Total straight-line length of a waypoint route, in world units. */
export function routeLength(points: Point[]): number {
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    total += Math.hypot(points[i].x - points[i - 1].x, points[i].y - points[i - 1].y);
  }
  return total;
}
