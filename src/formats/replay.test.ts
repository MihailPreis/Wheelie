import { describe, expect, it } from 'vitest';
import {
  decodeReplay,
  encodeReplay,
  hashTrack,
  InvalidReplayError,
  inputCode,
  inputLean,
  inputThrottle,
  Outcome,
  type Replay,
} from './replay';

function sample(overrides: Partial<Replay> = {}): Replay {
  const inputs = new Uint8Array(1000);
  inputs.fill(inputCode(1, 0), 0, 400);
  inputs.fill(inputCode(1, 1), 400, 407);
  inputs.fill(inputCode(-1, -1), 407, 1000);
  return {
    physicsVersion: 1,
    packId: 'gdtr-42',
    level: 2,
    track: 17,
    league: 3,
    trackHash: 0xdeadbeef,
    trackName: 'Трасса №1 ✓',
    player: 'MIK',
    date: 1_791_400_000,
    outcome: Outcome.Finished,
    wheelie: true,
    time: 12345,
    finalHash: 0xfeedf00d,
    inputs,
    trackData: null,
    ...overrides,
  };
}

const track = {
  startX: -100,
  startY: 5,
  finishX: 13107200,
  finishY: -7,
  points: Int32Array.from([-2147483648, 0, -5, 2147483647, 70000, -70000]),
  pointCount: 3,
  truncated: false,
};

// A small deterministic generator: the fuzz cases must be the same on every run.
function random(seed: number): () => number {
  let state = seed;
  return () => {
    state = (Math.imul(state, 1664525) + 1013904223) | 0;
    return (state >>> 8) / 0x1000000;
  };
}

describe('input codes', () => {
  it('round-trip every combination', () => {
    for (const throttle of [-1, 0, 1]) {
      for (const lean of [-1, 0, 1]) {
        const code = inputCode(throttle, lean);
        expect(code).toBeLessThan(9);
        expect([inputThrottle(code), inputLean(code)]).toEqual([throttle, lean]);
      }
    }
  });
});

describe('replay format', () => {
  it('round-trips a replay', () => {
    expect(decodeReplay(encodeReplay(sample()))).toEqual(sample());
  });

  it('stores long stretches of equal input compactly', () => {
    expect(encodeReplay(sample()).length).toBeLessThan(80);
  });

  it('round-trips an embedded track and an empty run', () => {
    const replay = sample({ trackData: track, inputs: new Uint8Array(0), outcome: Outcome.Abandoned, wheelie: false });
    expect(decodeReplay(encodeReplay(replay))).toEqual(replay);
  });

  it('hashes a track by its content', () => {
    const moved = { ...track, points: Int32Array.from([...track.points.slice(0, 5), -70001]) };
    expect(hashTrack(track)).toBe(hashTrack({ ...track, points: Int32Array.from(track.points) }));
    expect(hashTrack(moved)).not.toBe(hashTrack(track));
  });

  it('rejects what is not a replay', () => {
    expect(() => decodeReplay(new Uint8Array(0))).toThrow(InvalidReplayError);
    expect(() => decodeReplay(Uint8Array.from([1, 2, 3, 4, 5]))).toThrow(InvalidReplayError);
    const future = encodeReplay(sample());
    future[4] = 99;
    expect(() => decodeReplay(future)).toThrow(/not supported/);
    expect(() => decodeReplay(Uint8Array.from([...encodeReplay(sample()), 0]))).toThrow(InvalidReplayError);
  });

  it('rejects every truncation', () => {
    const bytes = encodeReplay(sample({ trackData: track }));
    for (let length = 0; length < bytes.length; length++) {
      expect(() => decodeReplay(bytes.slice(0, length))).toThrow(InvalidReplayError);
    }
  });

  it('survives damaged and random data', () => {
    const next = random(12345);
    const valid = encodeReplay(sample({ trackData: track }));
    const attempt = (bytes: Uint8Array) => {
      try {
        // Whatever is accepted must itself be a well-formed replay.
        const replay = decodeReplay(bytes);
        expect(decodeReplay(encodeReplay(replay))).toEqual(replay);
      } catch (error) {
        expect(error).toBeInstanceOf(InvalidReplayError);
      }
    };
    for (let round = 0; round < 3000; round++) {
      const damaged = Uint8Array.from(valid);
      for (let flips = 1 + Math.floor(next() * 3); flips > 0; flips--) {
        damaged[Math.floor(next() * damaged.length)] = Math.floor(next() * 256);
      }
      attempt(damaged);
      const noise = Uint8Array.from({ length: Math.floor(next() * 64) }, () => Math.floor(next() * 256));
      attempt(noise);
      attempt(Uint8Array.from([0x47, 0x44, 0x52, 0x1a, 1, ...noise]));
    }
  });
});
