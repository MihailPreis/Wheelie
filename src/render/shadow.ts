import type { Terrain } from '../core/terrain';

const SCALE = 8 / 65536;

/** A surface exists only between actual track endpoints; never extrapolate past them. */
export function shadowGround(terrain: Terrain, x: number): { y: number; slope: number } | null {
  for (let index = 0; index < terrain.pointCount - 1; index++) {
    const left = (terrain.points[index * 2] as number) * SCALE;
    const right = (terrain.points[index * 2 + 2] as number) * SCALE;
    if (x < left || x > right || right <= left) continue;
    const y = (terrain.points[index * 2 + 1] as number) * SCALE;
    const slope = ((terrain.points[index * 2 + 3] as number) * SCALE - y) / (right - left);
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
