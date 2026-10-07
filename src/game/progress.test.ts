import { describe, expect, it } from 'vitest';
import {
  availableLeagues,
  canStart,
  completedCount,
  completeTrack,
  initialProgress,
  isCheatName,
  loadProgress,
  saveProgress,
  unlockEverything,
} from './progress';

const COUNTS = [10, 10, 10];

describe('progress', () => {
  it('starts with the first track of easy and medium in the slowest league', () => {
    const p = initialProgress();
    expect(canStart(p, 0, 0, 0)).toBe(true);
    expect(canStart(p, 1, 0, 0)).toBe(true);
    expect(canStart(p, 0, 1, 0)).toBe(false);
    expect(canStart(p, 2, 0, 0)).toBe(false);
    expect(canStart(p, 0, 0, 1)).toBe(false);
    expect(availableLeagues(p)).toHaveLength(3);
  });

  it('unlocks the next track and selects it', () => {
    const p = initialProgress();
    const result = completeTrack(p, 0, 0, COUNTS);
    expect(result).toEqual({ levelCompleted: false, leagueUnlocked: null, everythingCompleted: false });
    expect(canStart(p, 0, 1, 0)).toBe(true);
    expect(canStart(p, 0, 2, 0)).toBe(false);
    expect(p.selectedTracks[0]).toBe(1);
    expect(completedCount(p, 0, COUNTS)).toBe(1);
  });

  it('does not lock anything when an earlier track is replayed', () => {
    const p = initialProgress();
    for (let track = 0; track < 5; track++) completeTrack(p, 0, track, COUNTS);
    completeTrack(p, 0, 1, COUNTS);
    expect(p.unlockedTracks[0]).toBe(5);
    expect(p.selectedTracks[0]).toBe(2);
  });

  it('unlocks a league and the hard level at the end of easy', () => {
    const p = initialProgress();
    let result = completeTrack(p, 0, 0, COUNTS);
    for (let track = 1; track < 10; track++) result = completeTrack(p, 0, track, COUNTS);
    expect(result.levelCompleted).toBe(true);
    expect(result.leagueUnlocked).toBe(1);
    expect(p.unlockedLeagues).toBe(1);
    expect(p.unlockedLevels).toBe(2);
    expect(canStart(p, 2, 0, 1)).toBe(true);
    expect(p.selectedLevel).toBe(1);
    expect(completedCount(p, 0, COUNTS)).toBe(10);
  });

  it('reveals the fourth league after the hard level and reports full completion', () => {
    const p = initialProgress();
    let result = completeTrack(p, 0, 0, COUNTS);
    for (let level = 0; level < 3; level++) {
      for (let track = 0; track < 10; track++) result = completeTrack(p, level, track, COUNTS);
    }
    expect(result.leagueUnlocked).toBe(3);
    expect(result.everythingCompleted).toBe(true);
    expect(availableLeagues(p)).toHaveLength(4);
    // Finishing the last track again unlocks nothing new.
    expect(completeTrack(p, 2, 9, COUNTS).leagueUnlocked).toBeNull();
  });

  it('has a cheat name that unlocks everything', () => {
    expect(isCheatName('RKE')).toBe(true);
    expect(isCheatName('AAA')).toBe(false);
    const p = initialProgress();
    unlockEverything(p, COUNTS);
    expect(canStart(p, 2, 9, 3)).toBe(true);
  });

  it('survives a round trip through storage and repairs out-of-range values', () => {
    const p = initialProgress();
    completeTrack(p, 0, 0, COUNTS);
    saveProgress('test-pack', p);
    expect(loadProgress('test-pack', COUNTS)).toEqual(p);

    saveProgress('small-pack', {
      ...p,
      unlockedTracks: [99, 99, 99],
      selectedTracks: [50, 50, 50],
      unlockedLeagues: 9,
    });
    const repaired = loadProgress('small-pack', [2, 3, 1]);
    expect(repaired.unlockedTracks).toEqual([2, 3, 1]);
    expect(repaired.selectedTracks).toEqual([1, 2, 0]);
    expect(repaired.unlockedLeagues).toBe(3);
    expect(loadProgress('unknown-pack', COUNTS)).toEqual(initialProgress());
  });
});
