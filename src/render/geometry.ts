/** Angle measured from +y. Works for both fixed-point positions and unit vectors. */
export function angleOf(x: number, y: number): number {
  return Math.atan2(x, y);
}
