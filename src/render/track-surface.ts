export interface SurfacePoint {
  x: number;
  y: number;
  /** 0 at the riding edge, 1 at the far edge. */
  depth: number;
}

export interface SurfaceFace {
  points: readonly [SurfacePoint, SurfacePoint, SurfacePoint, SurfacePoint];
  left: number;
  right: number;
  bottom: number;
  top: number;
}

export function surfaceFace(points: SurfaceFace['points']): SurfaceFace {
  const [a, b, c, d] = points;
  return {
    points,
    left: Math.min(a.x, b.x, c.x, d.x),
    right: Math.max(a.x, b.x, c.x, d.x),
    bottom: Math.min(a.y, b.y, c.y, d.y),
    top: Math.max(a.y, b.y, c.y, d.y),
  };
}

/** An interval tree avoids comparing every grid line with the whole visible track. */
export function surfaceIndex(faces: readonly SurfaceFace[]): (left: number, right: number) => number[] {
  interface Node {
    index: number;
    right: number;
    lower: Node | null;
    upper: Node | null;
  }
  const order = faces.map((_, index) => index).sort((a, b) => (faces[a]?.left ?? 0) - (faces[b]?.left ?? 0));
  const build = (start: number, end: number): Node | null => {
    if (start >= end) return null;
    const middle = (start + end) >>> 1;
    const index = order[middle] as number;
    const lower = build(start, middle);
    const upper = build(middle + 1, end);
    return {
      index,
      lower,
      upper,
      right: Math.max(faces[index]?.right ?? -Infinity, lower?.right ?? -Infinity, upper?.right ?? -Infinity),
    };
  };
  const root = build(0, order.length);
  return (left, right) => {
    const indices: number[] = [];
    const visit = (node: Node | null) => {
      if (!node || node.right < left) return;
      visit(node.lower);
      const face = faces[node.index];
      if (!face || face.left > right) return;
      if (face.right >= left) indices.push(node.index);
      visit(node.upper);
    };
    visit(root);
    return indices;
  };
}

function weights(point: SurfacePoint, a: SurfacePoint, b: SurfacePoint, c: SurfacePoint): number[] | null {
  const area = (b.y - c.y) * (a.x - c.x) + (c.x - b.x) * (a.y - c.y);
  if (Math.abs(area) < 1e-8) return null;
  const u = ((b.y - c.y) * (point.x - c.x) + (c.x - b.x) * (point.y - c.y)) / area;
  const v = ((c.y - a.y) * (point.x - c.x) + (a.x - c.x) * (point.y - c.y)) / area;
  return [u, v, 1 - u - v];
}

/** Portion of a line inside the triangle and behind its interpolated depth. */
function hiddenInterval(
  from: SurfacePoint,
  to: SurfacePoint,
  triangle: readonly [SurfacePoint, SurfacePoint, SurfacePoint],
): [number, number] | null {
  const start = weights(from, ...triangle);
  const end = weights(to, ...triangle);
  if (!start || !end) return null;
  let low = 0;
  let high = 1;
  const constrain = (a: number, b: number): boolean => {
    if (a < 0 && b < 0) return false;
    if (a < 0) low = Math.max(low, a / (a - b));
    else if (b < 0) high = Math.min(high, a / (a - b));
    return high > low;
  };
  for (let i = 0; i < 3; i++) {
    if (!constrain(start[i] as number, end[i] as number)) return null;
  }
  const depth = (w: number[]) => w.reduce((sum, value, i) => sum + value * (triangle[i]?.depth ?? 0), 0);
  // Shared edges at equal depth stay visible; only a closer surface hides a line.
  if (!constrain(from.depth - depth(start) - 1e-6, to.depth - depth(end) - 1e-6)) return null;
  return [low, high];
}

/** Clips grid lines against opaque faces without relying on an ambiguous whole-face drawing order. */
export function visibleSurfaceLine(
  from: SurfacePoint,
  to: SurfacePoint,
  faces: readonly SurfaceFace[],
  ownFace: number,
  candidates: Iterable<number> = faces.keys(),
): [SurfacePoint, SurfacePoint][] {
  let intervals: [number, number][] = [[0, 1]];
  const left = Math.min(from.x, to.x);
  const right = Math.max(from.x, to.x);
  const bottom = Math.min(from.y, to.y);
  const top = Math.max(from.y, to.y);
  for (const index of candidates) {
    const face = faces[index];
    if (!face) continue;
    if (index === ownFace || face.left > right || face.right < left || face.bottom > top || face.top < bottom) continue;
    const [a, b, c, d] = face.points;
    for (const triangle of [
      [a, b, c],
      [a, c, d],
    ] as const) {
      const hidden = hiddenInterval(from, to, triangle);
      if (!hidden) continue;
      const [low, high] = hidden;
      intervals = intervals.flatMap(([start, end]) => {
        if (high <= start || low >= end) return [[start, end]] as [number, number][];
        const remaining: [number, number][] = [];
        if (low > start) remaining.push([start, low]);
        if (high < end) remaining.push([high, end]);
        return remaining;
      });
      if (intervals.length === 0) return [];
    }
  }
  const at = (t: number): SurfacePoint => ({
    x: from.x + (to.x - from.x) * t,
    y: from.y + (to.y - from.y) * t,
    depth: from.depth + (to.depth - from.depth) * t,
  });
  return intervals.filter(([start, end]) => end - start > 1e-6).map(([start, end]) => [at(start), at(end)]);
}
