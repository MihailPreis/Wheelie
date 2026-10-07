import { describe, expect, it } from 'vitest';
import { Sim, Status } from '../core/sim';
import { encodeTrack, parseTrack } from '../formats/mrg';
import {
  fromTrackData,
  groundY,
  insertPoint,
  isEditorTrack,
  movePoint,
  removePoint,
  templateTrack,
  toTrackData,
} from './model';

describe('editor track', () => {
  it('starts from a template the game can ride', () => {
    const sim = new Sim({ track: toTrackData(templateTrack('New')), league: 0, demo: false });
    let status: Status = Status.BeforeStart;
    for (let tick = 0; tick < 300; tick++) status = sim.step(1, 0);
    expect([Status.Riding, Status.Finished, Status.FinishedLate]).toContain(status);
  });

  it('survives the pack format unchanged', () => {
    const track = templateTrack('New');
    const again = fromTrackData('New', parseTrack(encodeTrack(toTrackData(track)), 0));
    expect(again).toEqual(track);
    expect(isEditorTrack(again)).toBe(true);
  });

  it('keeps points in order when one is moved', () => {
    const track = templateTrack('New');
    movePoint(track, 3, 5000, 7.4);
    expect(track.points[3]).toEqual({ x: (track.points[4]?.x ?? 0) - 1, y: 7 });
    movePoint(track, 3, -5000, 0);
    expect(track.points[3]?.x).toBe((track.points[2]?.x ?? 0) + 1);
  });

  it('inserts between neighbours and refuses a taken x', () => {
    const track = templateTrack('New');
    expect(insertPoint(track, -100, 3)).toBe(3);
    expect(track.points[3]).toEqual({ x: -100, y: 3 });
    expect(insertPoint(track, -100, 9)).toBe(-1);
  });

  it('never drops below three points', () => {
    const track = templateTrack('New');
    while (removePoint(track, 0)) {
      // Keep removing.
    }
    expect(track.points).toHaveLength(3);
  });

  it('keeps the start above the ground and the finish after it', () => {
    const track = templateTrack('New');
    track.start = { x: 99999, y: -500 };
    track.finishX = -99999;
    movePoint(track, 0, track.points[0]?.x ?? 0, track.points[0]?.y ?? 0);
    const last = track.points[track.points.length - 1]?.x ?? 0;
    expect(track.start.x).toBeLessThan(last);
    expect(track.start.y).toBeGreaterThanOrEqual(groundY(track, track.start.x) + 8);
    expect(track.finishX).toBeGreaterThan(track.start.x);
    expect(track.finishX).toBeLessThan(last);
  });

  it('recognises what is not a track', () => {
    expect(isEditorTrack(null)).toBe(false);
    expect(isEditorTrack({ ...templateTrack('x'), points: [{ x: 0, y: 0 }] })).toBe(false);
    const unordered = templateTrack('x');
    unordered.points.reverse();
    expect(isEditorTrack(unordered)).toBe(false);
  });
});
