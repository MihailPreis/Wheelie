import { describe, expect, it } from 'vitest';
import { createPose } from './sim';
import { Terrain } from './terrain';
import { groundSegment, outsideTrack } from './track-surface';

const ONE = 65536;
const terrain = new Terrain({
  truncated: false,
  points: Int32Array.from([0, 0, 10 * ONE, 0, 20 * ONE, 10 * ONE]),
  pointCount: 3,
  startX: 2 * ONE,
  startY: 4 * ONE,
  finishX: 18 * ONE,
  finishY: 10 * ONE,
});

function poseAt(x: number, y: number) {
  const pose = createPose();
  pose.x.fill(x * ONE * 2);
  pose.y.fill(y * ONE * 2);
  return pose;
}

describe('actual track surface', () => {
  it('includes the end points but does not extrapolate beyond them', () => {
    expect(groundSegment(terrain, -1)).toBeNull();
    expect(groundSegment(terrain, 0)).toBe(0);
    expect(groundSegment(terrain, 10 * ONE)).toBe(1);
    expect(groundSegment(terrain, 20 * ONE)).toBe(1);
    expect(groundSegment(terrain, 20 * ONE + 1)).toBeNull();
  });

  it('allows jumps and deeply compressed wheels while the frame is above ground', () => {
    expect(outsideTrack(terrain, poseAt(5, 30))).toBe(false);
    const compressed = poseAt(5, 3);
    compressed.y[1] = compressed.y[2] = -4 * ONE;
    expect(outsideTrack(terrain, compressed)).toBe(false);
    expect(outsideTrack(terrain, poseAt(5, 0))).toBe(false);
  });

  it('detects a whole bike below flat or sloped ground', () => {
    expect(outsideTrack(terrain, poseAt(5, -2))).toBe(true);
    expect(outsideTrack(terrain, poseAt(15, 3))).toBe(true);
    expect(outsideTrack(terrain, poseAt(15, 7))).toBe(false);
  });

  it('requires the bike to clear an edge and ignores detached parts left behind', () => {
    expect(outsideTrack(terrain, poseAt(-0.5, 10))).toBe(false);
    const left = poseAt(-2, 10);
    left.x[5] = 5 * ONE;
    expect(outsideTrack(terrain, left)).toBe(true);
    expect(outsideTrack(terrain, poseAt(22, 10))).toBe(true);
  });

  it('detects a fall beside an edge when the remaining bodies over ground are underneath', () => {
    const pose = poseAt(-2, -2);
    pose.x[0] = ONE;
    expect(outsideTrack(terrain, pose)).toBe(true);
  });
});
