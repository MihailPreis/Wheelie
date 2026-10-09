import type { Pose } from './sim';
import { BODY_RADII, type Terrain } from './terrain';

/** Finds actual ground, without extending the end segments beyond the track. Coordinates are in track space. */
export function groundSegment(terrain: Terrain, x: number): number | null {
  const { points, pointCount } = terrain;
  if (x < (points[0] as number) || x > (points[(pointCount - 1) * 2] as number)) return null;
  let low = 0;
  let high = pointCount - 1;
  while (low + 1 < high) {
    const middle = (low + high) >>> 1;
    if ((points[middle * 2] as number) <= x) low = middle;
    else high = middle;
  }
  return (points[high * 2] as number) > (points[low * 2] as number) ? low : null;
}

/**
 * Run termination policy, separate from the original physics so existing replay hashes stay valid.
 * Every body must be clear of the surface: a compressed wheel alone is still a normal landing.
 */
export function outsideTrack(terrain: Terrain, pose: Pose): boolean {
  const left = (terrain.points[0] as number) * 2;
  const right = (terrain.points[(terrain.pointCount - 1) * 2] as number) * 2;
  const wheelRadius = BODY_RADII[0];
  // Detached parts must not keep a bike that has gone over an edge alive.
  const frameX = pose.x[0] as number;
  const frontX = pose.x[1] as number;
  const rearX = pose.x[2] as number;
  if (Math.max(frameX, frontX, rearX) + wheelRadius < left) return true;
  if (Math.min(frameX, frontX, rearX) - wheelRadius > right) return true;

  let overGround = false;
  for (let body = 0; body < pose.x.length; body++) {
    const x = (pose.x[body] as number) >> 1;
    const segment = groundSegment(terrain, x);
    if (segment === null) continue;
    overGround = true;
    const radius = BODY_RADII[body === 1 || body === 2 ? 0 : body === 5 ? 2 : 1];
    // The collision plane is one track unit below the body-space projection. Allow another
    // half unit of penetration even above the top of each body before declaring a fall through.
    const top = ((pose.y[body] as number) >> 1) - 0x10000 + (radius >> 1) + 0x8000;
    const ax = terrain.points[segment * 2] as number;
    const ay = terrain.points[segment * 2 + 1] as number;
    const bx = terrain.points[segment * 2 + 2] as number;
    const by = terrain.points[segment * 2 + 3] as number;
    // Cross products may exceed the exact integer range of a double on imported tracks.
    if (BigInt(top - ay) * BigInt(bx - ax) >= BigInt(x - ax) * BigInt(by - ay)) return false;
  }
  return overGround;
}
