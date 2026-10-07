import type { TrackData } from '../formats/mrg';
import { approxLength, DivisionByZeroError, div, mul, mulWide } from './fpmath';

/** Collision radii of the three kinds of body: wheel, frame point, rider's head. */
export const BODY_RADII: readonly [number, number, number] = [0x1c000, 0x10000, 32768];

/** Result of testing a body against the ground. */
export const Contact = {
  /** Penetrating: the step has to be retried with a smaller time step. */
  Deep: 0,
  /** Touching: the contact gets resolved. */
  Touching: 1,
  None: 2,
} as const;
export type Contact = (typeof Contact)[keyof typeof Contact];

export class InvalidTrackError extends Error {
  constructor() {
    super('Track geometry is not valid');
    this.name = 'InvalidTrackError';
  }
}

/** The part of a body's state the ground test looks at. */
interface Collider {
  x: number;
  y: number;
  vx: number;
  vy: number;
}

/**
 * Track geometry and ground collision. Ported from `Levels/Loader.java` and the data half of
 * `Levels/Level.java`.
 *
 * Track points are stored at half the scale of body coordinates, as in the original.
 */
export class Terrain {
  readonly points: Int32Array;
  readonly pointCount: number;
  readonly startX: number;
  readonly startY: number;
  /** Index of the point the start flag stands on (`Level.m_gotoI`). */
  readonly startIndex: number;
  /** Index of the point the finish flag stands on (`Level.m_forI`). */
  readonly finishIndex: number;

  /** Normal of the last contact found by {@link collide} (`Loader.m_eI`, `m_dI`). */
  normalX = 0;
  normalY = 0;

  /** Window of segments around the bike that are tested for collision (`m_eaI`, `m_faI`). */
  windowStart = 0;
  windowEnd = 0;
  /** x of the window's first and last points (`m_aI`, `m_kI`). */
  windowStartX = 0;
  windowEndX = 0;

  /** Horizontal extent and height of the bike, kept for drawing shadows (`Level.m_eI`, `m_bI`, `m_gI`). */
  shadowLeft = 0;
  shadowRight = 0;
  shadowY = 0;

  /** Unit normal of each segment, interleaved x, y (`m_saaI`). */
  private readonly normals: Int32Array;
  /** Squared outer and inner contact distances per body kind (`m_haI`, `m_vaI`). */
  private readonly outerSquared: number[] = [];
  private readonly innerSquared: number[] = [];

  constructor(track: TrackData) {
    this.points = track.points;
    this.pointCount = track.pointCount;
    this.startX = track.startX;
    this.startY = track.startY;

    for (const radius of BODY_RADII) {
      this.outerSquared.push(mul((radius + 19660) >> 1, (radius + 19660) >> 1));
      this.innerSquared.push(mul((radius - 19660) >> 1, (radius - 19660) >> 1));
    }

    // Loader.load
    const count = this.pointCount;
    if (count < 2) throw new InvalidTrackError();
    this.normals = new Int32Array(count * 2);
    let startIndex = 0;
    let finishIndex = 0;
    try {
      for (let k = 0; k < count; k++) {
        const next = (k + 1) % count;
        const dx = (this.px(next) - this.px(k)) | 0;
        const dy = (this.py(next) - this.py(k)) | 0;
        const nx = -dy | 0;
        const ny = dx;
        const length = approxLength(nx, ny);
        this.normals[k * 2] = div(nx, length);
        this.normals[k * 2 + 1] = div(ny, length);
        if (startIndex === 0 && this.px(k) > track.startX) startIndex = k + 1;
        if (finishIndex === 0 && this.px(k) > track.finishX) finishIndex = k;
      }
    } catch (error) {
      if (error instanceof DivisionByZeroError) throw new InvalidTrackError();
      throw error;
    }
    this.startIndex = startIndex;
    this.finishIndex = finishIndex;
  }

  // Reads past the last point behave like a freshly allocated Java array: zero.
  private px(index: number): number {
    return index < this.pointCount ? (this.points[index * 2] as number) : 0;
  }

  private py(index: number): number {
    return index < this.pointCount ? (this.points[index * 2 + 1] as number) : 0;
  }

  /** Where the bike is placed at the start, in body coordinates (`_newvI`, `_avI`). */
  get spawnX(): number {
    return this.startX << 1;
  }

  get spawnY(): number {
    return this.startY << 1;
  }

  /** x of the start line in body coordinates (`_intvI`). */
  get startLineX(): number {
    return this.px(this.startIndex) << 1;
  }

  /** x of the finish line in body coordinates (`_dovI`). */
  get finishLineX(): number {
    return this.px(this.finishIndex) << 1;
  }

  /** Progress from start to finish as 16.16 in 0…1, for a body-space x (`_aII`, `Level._doII`). */
  progress(x: number): number {
    const fromStart = ((x >> 1) - this.px(this.startIndex)) | 0;
    const span = (this.px(this.finishIndex) - this.px(this.startIndex)) | 0;
    if ((span >= 0 ? span : -span | 0) < 3 || fromStart > span) return 0x10000;
    return div(fromStart, span);
  }

  /** Moves the collision window to cover the horizontal range `left`…`right` (`_aIIV`). */
  setWindow(left: number, right: number, y: number): void {
    this.shadowLeft = (left + 0x18000) >> 1;
    this.shadowRight = (right - 0x18000) >> 1;
    this.shadowY = y >> 1;

    const last = this.pointCount - 1;
    const k = right >> 1;
    const j = left >> 1;
    let start = this.windowStart;
    let end = this.windowEnd;
    end = end >= last ? last : end;
    start = start >= 0 ? start : 0;
    if (k > this.windowEndX) {
      while (end < last && k > this.px(++end));
    } else if (j < this.windowStartX) {
      while (start > 0 && j < this.px(--start));
    } else {
      while (start < this.pointCount && j > this.px(++start));
      if (start > 0) start--;
      while (end > 0 && k < this.px(--end));
      end = end + 1 >= last ? last : end + 1;
    }
    this.windowStart = start;
    this.windowEnd = end;
    this.windowStartX = this.px(start);
    this.windowEndX = this.px(end);
  }

  /**
   * Tests a body against the segments in the window (`_anvI`). On contact the surface normal is
   * left in {@link normalX}, {@link normalY}.
   */
  collide(body: Collider, kind: number): Contact {
    const outer = this.outerSquared[kind] as number;
    const inner = this.innerSquared[kind] as number;
    const x = body.x >> 1;
    // The original subtracts this only with the "perspective" option on. The option is on by
    // default and merely shifts the bike relative to the track, so the simulation always applies it.
    const y = ((body.y >> 1) - 0x10000) | 0;

    let touching = 0;
    let result: Contact = Contact.None;
    let sumX = 0;
    let sumY = 0;

    for (let segment = this.windowStart; segment < this.windowEnd; segment++) {
      const ax = this.px(segment);
      const ay = this.py(segment);
      const bx = this.px(segment + 1);
      const by = this.py(segment + 1);
      if (((x - outer) | 0) > bx || ((x + outer) | 0) < ax) continue;

      let dx = (ax - bx) | 0;
      let dy = (ay - by) | 0;
      const lengthSquared = (mul(dx, dx) + mul(dy, dy)) | 0;
      const projection = (mul((x - ax) | 0, -dx | 0) + mul((y - ay) | 0, -dy | 0)) | 0;
      let t: number;
      if ((lengthSquared >= 0 ? lengthSquared : -lengthSquared | 0) >= 3) t = div(projection, lengthSquared);
      else t = Math.imul(Math.imul(projection <= 0 ? -1 : 1, lengthSquared <= 0 ? -1 : 1), 0x7fffffff);
      if (t < 0) t = 0;
      if (t > 0x10000) t = 0x10000;

      const nearestX = (ax + mul(t, -dx | 0)) | 0;
      const nearestY = (ay + mul(t, -dy | 0)) | 0;
      dx = (x - nearestX) | 0;
      dy = (y - nearestY) | 0;

      // Compared as 64-bit values in the original, so this must not be truncated to 32 bits.
      const distanceSquared = mulWide(dx, dx) + mulWide(dy, dy);
      let contact: Contact;
      if (distanceSquared < outer) contact = distanceSquared >= inner ? Contact.Touching : Contact.Deep;
      else contact = Contact.None;

      const nx = this.normals[segment * 2] as number;
      const ny = this.normals[segment * 2 + 1] as number;
      const approach = (mul(nx, body.vx) + mul(ny, body.vy)) | 0;
      if (contact === Contact.Deep && approach < 0) {
        this.normalX = nx;
        this.normalY = ny;
        return Contact.Deep;
      }
      if (contact !== Contact.Touching || approach >= 0) continue;

      touching++;
      result = Contact.Touching;
      if (touching === 1) {
        sumX = nx;
        sumY = ny;
      } else {
        sumX = (sumX + nx) | 0;
        sumY = (sumY + ny) | 0;
      }
    }

    if (result === Contact.Touching) {
      if (((mul(sumX, body.vx) + mul(sumY, body.vy)) | 0) >= 0) return Contact.None;
      this.normalX = sumX;
      this.normalY = sumY;
    }
    return result;
  }
}
