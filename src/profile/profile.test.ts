import { describe, expect, it } from 'vitest';
import { decodeProfile, encodeProfile, isProfile } from './profile';

describe('profile backup', () => {
  const replays = [Uint8Array.of(1, 2, 3), new Uint8Array(0), Uint8Array.of(9)];

  it('gives back the replays it was made of', () => {
    const bytes = encodeProfile(replays);
    expect(isProfile(bytes)).toBe(true);
    expect(decodeProfile(bytes, 100)).toEqual(replays);
  });

  it('refuses files that are something else, cut short or oversized', () => {
    const bytes = encodeProfile(replays);
    expect(() => decodeProfile(Uint8Array.of(1, 2, 3, 4, 5, 6, 7, 8, 9), 100)).toThrow();
    expect(() => decodeProfile(bytes.slice(0, bytes.length - 1), 100)).toThrow();
    expect(() => decodeProfile(bytes, 2)).toThrow();
    const other = bytes.slice();
    other[4] = 2;
    expect(() => decodeProfile(other, 100)).toThrow();
    // A count that promises more than the file holds.
    const greedy = bytes.slice();
    greedy[8] = 200;
    expect(() => decodeProfile(greedy, 100)).toThrow();
  });
});
