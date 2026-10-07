import { describe, expect, it } from 'vitest';
import { addScore, clearScores, emptyScores, formatScoreTime, loadScores, placeOf, saveScores } from './highscores';

describe('high scores', () => {
  it('ranks times and keeps the best three per league', () => {
    const scores = emptyScores();
    expect(placeOf(scores, 0, 5000)).toBe(0);
    expect(addScore(scores, 0, 'AAA', 5000)).toBe(0);
    expect(addScore(scores, 0, 'BBB', 4000)).toBe(0);
    expect(addScore(scores, 0, 'CCC', 4500)).toBe(1);
    expect(addScore(scores, 0, 'DDD', 6000)).toBe(3);
    expect(addScore(scores, 0, 'EEE', 4200)).toBe(1);
    expect(scores[0]).toEqual([
      { name: 'BBB', time: 4000 },
      { name: 'EEE', time: 4200 },
      { name: 'CCC', time: 4500 },
    ]);
    expect(scores[1]).toEqual([]);
  });

  it('puts an equal time behind the one already there', () => {
    const scores = emptyScores();
    addScore(scores, 2, 'AAA', 1000);
    expect(placeOf(scores, 2, 1000)).toBe(1);
  });

  it('formats times as mm:ss.cc', () => {
    expect(formatScoreTime(0)).toBe('00:00.00');
    expect(formatScoreTime(1234)).toBe('00:12.34');
    expect(formatScoreTime(61005)).toBe('10:10.05');
  });

  it('stores scores per pack and track, and clears a pack', () => {
    const scores = emptyScores();
    addScore(scores, 1, 'ZZZ', 777);
    saveScores('pack-a', 0, 3, scores);
    expect(loadScores('pack-a', 0, 3)).toEqual(scores);
    expect(loadScores('pack-a', 0, 4)).toEqual(emptyScores());
    expect(loadScores('pack-b', 0, 3)).toEqual(emptyScores());
    clearScores('pack-a');
    expect(loadScores('pack-a', 0, 3)).toEqual(emptyScores());
  });
});
