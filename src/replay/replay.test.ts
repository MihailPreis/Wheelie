import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { Sim } from '../core/sim';
import { PHYSICS_VERSION } from '../core/version';
import { parsePackHeader, parseTrack } from '../formats/mrg';
import { decodeReplay, encodeReplay, hashTrack, inputCode, Outcome, type Replay } from '../formats/replay';
import { simulate, verifyReplay } from './simulate';
import { personalBests, type StoredReplay, surplus } from './store';

const bytes = new Uint8Array(readFileSync('public/assets/levels/levels.mrg'));
const entry = parsePackHeader(bytes).levels[0]?.[0];
if (!entry) throw new Error('The first track is missing');
const track = parseTrack(bytes, entry.offset);

/** Rides the way the game does and writes down what happened. */
function record(ticks: number): Replay {
  const sim = new Sim({ track, league: 1, demo: false });
  const inputs = new Uint8Array(ticks);
  for (let tick = 0; tick < ticks; tick++) {
    const throttle = tick % 300 < 250 ? 1 : -1;
    const lean = tick % 90 < 30 ? 1 : tick % 90 < 60 ? 0 : -1;
    inputs[tick] = inputCode(throttle, lean);
    sim.step(throttle, lean);
  }
  return {
    physicsVersion: PHYSICS_VERSION,
    packId: 'original',
    level: 0,
    track: 0,
    league: 1,
    trackHash: hashTrack(track),
    trackName: entry?.name ?? '',
    player: 'AAA',
    date: 1_791_400_000,
    outcome: Outcome.Abandoned,
    wheelie: false,
    time: 0,
    finalHash: sim.hash() >>> 0,
    inputs,
    trackData: null,
  };
}

describe('replays', () => {
  it('reproduce the run they were recorded from, also after a round trip through the file format', () => {
    const replay = record(900);
    expect(verifyReplay(track, replay)).toBe(true);
    expect(verifyReplay(track, decodeReplay(encodeReplay(replay)))).toBe(true);
  });

  it('do not verify once an input has changed', () => {
    const replay = record(900);
    replay.inputs[100] = inputCode(-1, 0);
    expect(simulate(track, replay).finalHash).not.toBe(replay.finalHash);
    expect(verifyReplay(track, replay)).toBe(false);
  });

  it('do not verify on another league', () => {
    expect(verifyReplay(track, { ...record(900), league: 2 })).toBe(false);
  });
});

describe('surplus', () => {
  const stored = (id: string, date: number, outcome: Outcome) => ({ id, date, outcome }) as StoredReplay;

  it('drops the oldest unfinished runs and never a finished one', () => {
    const replays = [
      stored('a', 1, Outcome.Crashed),
      stored('b', 2, Outcome.Finished),
      stored('c', 3, Outcome.Abandoned),
      stored('d', 4, Outcome.Crashed),
    ];
    expect(surplus(replays, 2).map((replay) => replay.id)).toEqual(['a']);
    expect(surplus(replays, 3)).toEqual([]);
  });
});

describe('personalBests', () => {
  const run = (id: string, track: number, league: number, time: number, outcome: Outcome = Outcome.Finished) =>
    ({ id, packId: 'original', level: 0, track, league, time, date: 0, outcome }) as StoredReplay;

  it('marks the fastest finish of every track and league', () => {
    const replays = [
      run('a', 0, 0, 5000),
      run('b', 0, 0, 4000),
      run('c', 0, 1, 9000),
      run('d', 1, 0, 0, Outcome.Crashed),
    ];
    expect([...personalBests(replays)].sort()).toEqual(['b', 'c']);
  });
});
