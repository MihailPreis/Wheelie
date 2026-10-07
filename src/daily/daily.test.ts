import { describe, expect, it } from 'vitest';
import { removeAll } from '../storage/store';
import {
  type Candidate,
  dailyBest,
  dailyStreak,
  dayLabel,
  dayOf,
  parseCandidates,
  pickDaily,
  recordDaily,
} from './daily';

const candidates: Candidate[] = Array.from({ length: 10 }, (_, index) => [index + 1, index % 3, index]);

describe('daily track', () => {
  it('turns over at midnight UTC', () => {
    expect(dayOf(Date.UTC(2026, 9, 8, 0, 0, 0))).toBe(20734);
    expect(dayOf(Date.UTC(2026, 9, 8, 23, 59, 59))).toBe(20734);
    expect(dayOf(Date.UTC(2026, 9, 9, 0, 0, 0))).toBe(20735);
    expect(dayLabel(20734)).toBe('8 October 2026');
  });

  it('is the same for everyone on the same day', () => {
    // These values are the contract: changing the rule changes everybody's track of the day.
    expect(pickDaily(candidates, 20734)).toEqual({ day: 20734, packId: 'gdtr-9', level: 2, track: 8, league: 1 });
    expect(pickDaily(candidates, 20735)).toEqual({ day: 20735, packId: 'gdtr-6', level: 2, track: 5, league: 1 });
  });

  it('goes through every track before repeating one', () => {
    for (const count of [1, 2, 7, 10, 762]) {
      const list: Candidate[] = Array.from({ length: count }, (_, index) => [index, 0, 0]);
      const seen = new Set<string>();
      for (let day = 20000; day < 20000 + count; day++) seen.add(pickDaily(list, day)?.packId ?? '');
      expect(seen.size).toBe(count);
    }
  });

  it('uses the three lower leagues', () => {
    const leagues = new Set<number>();
    for (let day = 20000; day < 20100; day++) leagues.add(pickDaily(candidates, day)?.league ?? -1);
    expect([...leagues].sort()).toEqual([0, 1, 2]);
  });

  it('has no track without candidates and ignores malformed ones', () => {
    expect(pickDaily([], 1)).toBeNull();
    expect(parseCandidates([[1, 2, 3], [1, 3, 0], [1, 0], 'x', [1.5, 0, 0], [-1, 0, 0]])).toEqual([[1, 2, 3]]);
    expect(() => parseCandidates({})).toThrow();
  });

  it('keeps the best time of a day and counts days in a row', () => {
    removeAll('daily.');
    expect(dailyBest(100)).toBeNull();
    expect(recordDaily(100, 5000)).toBe(true);
    expect(recordDaily(100, 6000)).toBe(false);
    expect(recordDaily(100, 4000)).toBe(true);
    expect(dailyBest(100)).toBe(4000);
    recordDaily(99, 1);
    recordDaily(97, 1);
    expect(dailyStreak(100)).toBe(2);
    // Today not ridden yet: yesterday's streak still stands.
    expect(dailyStreak(101)).toBe(2);
    expect(dailyStreak(102)).toBe(0);
  });
});
