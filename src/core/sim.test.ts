import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePackHeader, parseTrack, type TrackData } from '../formats/mrg';
import { InvalidTrackError, Sim, Status, TICK_MILLISECONDS } from './sim';

const pack = new Uint8Array(readFileSync('public/assets/levels/levels.mrg'));
const header = parsePackHeader(pack);
const trackAt = (level: number, index: number): TrackData => {
  const entry = header.levels[level]?.[index];
  if (!entry) throw new Error('missing track');
  return parseTrack(pack, entry.offset);
};

/** A fixed, arbitrary but repeatable control sequence. */
const controls = (tick: number): [number, number] => [
  tick % 97 < 80 ? 1 : 0,
  tick % 53 < 20 ? -1 : tick % 53 < 30 ? 1 : 0,
];

describe('Sim', () => {
  it('is repeatable', () => {
    const a = new Sim({ track: trackAt(0, 0), league: 1 });
    const b = new Sim({ track: trackAt(0, 0), league: 1 });
    for (let tick = 0; tick < 300; tick++) {
      a.step(...controls(tick));
      b.step(...controls(tick));
    }
    expect(a.hash()).toBe(b.hash());
  });

  it('continues identically from a snapshot', () => {
    const straight = new Sim({ track: trackAt(0, 1), league: 2 });
    const resumed = new Sim({ track: trackAt(0, 1), league: 2 });
    const hashes: number[] = [];
    let snapshot = straight.save();
    for (let tick = 0; tick < 400; tick++) {
      if (tick === 150) snapshot = straight.save();
      straight.step(...controls(tick));
      hashes.push(straight.hash());
    }

    // Run the second simulation somewhere else entirely first, then jump back.
    for (let tick = 0; tick < 90; tick++) resumed.step(-1, 1);
    resumed.load(snapshot);
    expect(resumed.ticks).toBe(150);
    for (let tick = 150; tick < 400; tick++) {
      resumed.step(...controls(tick));
      expect(resumed.hash(), `tick ${tick}`).toBe(hashes[tick]);
    }
    expect(resumed.raceTicks).toBe(straight.raceTicks);
    expect(resumed.status).toBe(straight.status);
  });

  it('starts the race clock at the start line', () => {
    const sim = new Sim({ track: trackAt(0, 0), league: 0 });
    expect(sim.status).toBe(Status.BeforeStart);
    let status: Status = sim.step(1, 0);
    while (status === Status.BeforeStart) {
      expect(sim.raceTicks).toBe(0);
      status = sim.step(1, 0);
    }
    const crossedAt = sim.ticks;
    expect(sim.raceTicks).toBe(0);
    sim.step(1, 0);
    sim.step(1, 0);
    expect(sim.ticks - crossedAt).toBe(2);
    expect(sim.raceTime).toBe(2 * TICK_MILLISECONDS);
  });

  it('rejects tracks without usable geometry', () => {
    const empty: TrackData = { ...trackAt(0, 0), points: new Int32Array(0), pointCount: 0 };
    expect(() => new Sim({ track: empty, league: 0 })).toThrow(InvalidTrackError);
    const single: TrackData = { ...trackAt(0, 0), points: Int32Array.from([0, 0]), pointCount: 1 };
    expect(() => new Sim({ track: single, league: 0 })).toThrow(InvalidTrackError);
  });
});
