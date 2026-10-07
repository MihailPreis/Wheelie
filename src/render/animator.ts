import type { Pose } from '../core/sim';
import type { Terrain } from '../core/terrain';

/**
 * Presentation state that evolves over time but is not part of the simulation: the look-ahead
 * camera, the waving flags and the fading ground shadow. It advances once per simulation tick, so
 * a replay of the same run always looks the same.
 */
export class Animator {
  /** Look-ahead offset of the camera, in body-space fixed point (`Physics.m_oI`, `m_nI`). */
  lookX = 0;
  lookY = 0;
  /** Phase of the flag animation; the integer part selects the frame (`GameView.m_VI`). */
  flagPhase = 0;
  private flagClock = 0;
  /** Smoothed height of the bike above the ground, in track-space fixed point (`Level.m_rI`). */
  shadowHeight = 0;
  /** Segments under the rear and front ends of the bike, for the shadow. */
  shadowFrom = 0;
  shadowTo = 0;

  reset(): void {
    this.lookX = this.lookY = 0;
    this.shadowHeight = 0;
  }

  /**
   * @param lookAhead the "look ahead" option
   * @param viewSize the smaller side of the view in dp, which bounds how far the camera may lead
   */
  step(pose: Pose, terrain: Terrain, lookAhead: boolean, viewSize: number): void {
    // Physics._caseIV, _elsevI, _ifvI
    const limit = (10 * viewSize * 65536) / 128;
    if (lookAhead) {
      this.lookX = pose.frameVx / 24 + this.lookX * 0.875;
      this.lookY = pose.frameVy / 24 + this.lookY * 0.875;
    } else {
      this.lookX = this.lookY = 0;
    }
    this.lookX = Math.max(-limit, Math.min(limit, this.lookX));
    this.lookY = Math.max(-limit, Math.min(limit, this.lookY));

    // GameView._dovV
    this.flagClock += 655 / 65535;
    this.flagPhase += 0.1 * (0.5 + Math.abs(Math.sin(this.flagClock)) / 2);
    if (this.flagPhase > 3.5) this.flagPhase = 0;

    // Level._aiIV picks the segments, Level._ifiIV smooths the height.
    const points = terrain.points;
    const count = terrain.pointCount;
    let from = 0;
    let to = 0;
    for (let i = 2; i < count - 1 && (from === 0 || to === 0); i++) {
      const x = points[i * 2] as number;
      if (x > pose.shadowLeft && from === 0) from = i - 1;
      if (x > pose.shadowRight && to === 0) to = i - 1;
    }
    this.shadowFrom = from;
    this.shadowTo = to;
    if (to <= count - 2) {
      const groundA = points[from * 2 + 1] as number;
      const groundB = points[(to + 1) * 2 + 1] as number;
      let height = Math.max(0, pose.shadowY - (groundA + groundB) / 2);
      if (pose.shadowY <= groundA || pose.shadowY <= groundB) height = Math.min(height, 0x50000);
      this.shadowHeight = this.shadowHeight * 0.75 + height * 0.25;
    }
  }
}
