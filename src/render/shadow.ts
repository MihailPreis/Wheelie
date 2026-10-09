import type { Terrain } from '../core/terrain';

const SCALE = 8 / 65536;

/** A surface exists only between actual track endpoints; never extrapolate past them. */
export function shadowGround(terrain: Terrain, x: number): { y: number; slope: number } | null {
  // Lower bound keeps the original segment choice at an exact shared vertex.
  const { points, pointCount } = terrain;
  if (pointCount < 2 || x < (points[0] as number) * SCALE || x > (points[(pointCount - 1) * 2] as number) * SCALE)
    return null;
  let low = 1;
  let high = pointCount - 1;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((points[middle * 2] as number) * SCALE < x) low = middle + 1;
    else high = middle;
  }
  const index = low - 1;
  const left = (points[index * 2] as number) * SCALE;
  const right = (points[index * 2 + 2] as number) * SCALE;
  if (right > left) {
    const y = (points[index * 2 + 1] as number) * SCALE;
    const slope = ((points[index * 2 + 3] as number) * SCALE - y) / (right - left);
    return { y: y + (x - left) * slope, slope };
  }
  return null;
}

/** Same depth direction as the track's far edge, in dp. */
export function shadowDepth(x: number, y: number, eyeX: number, eyeY: number): [number, number] {
  const dx = eyeX - x;
  const dy = eyeY - y;
  const ax = Math.abs(dx);
  const ay = Math.abs(dy);
  const length = (64448 / 65536) * Math.max(ax, ay) + (28224 / 65536) * Math.min(ax, ay);
  return length === 0 ? [0, 0] : [(32 * dx) / length, (32 * dy) / length];
}
