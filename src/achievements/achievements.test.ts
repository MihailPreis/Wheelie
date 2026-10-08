import { readFileSync } from 'node:fs';
import { beforeEach, describe, expect, it } from 'vitest';
import { parsePackHeader, parseTrack } from '../formats/mrg';
import { inputCode } from '../formats/replay';
import { removeAll } from '../storage/store';
import { STRINGS } from '../ui/strings';
import { RU } from '../ui/strings-ru';
import { ACHIEVEMENTS, award, countRun, earnedAchievements, type RunContext, runAchievements } from './achievements';
import { analyseRun, type RunFacts } from './analyse';

const bytes = new Uint8Array(readFileSync('public/assets/levels/levels.mrg'));
const entry = parsePackHeader(bytes).levels[0]?.[0];
if (!entry) throw new Error('The first track is missing');
const intro = parseTrack(bytes, entry.offset);

const clean: RunFacts = {
  finished: true,
  braked: false,
  coasted: false,
  leaned: false,
  turns: 0.2,
  crashedAt: null,
  finishedAt: null,
  flips: [],
};
const context: RunContext = { level: 1, daily: false, wheelie: false, time: 10_000, ghostTime: null };

describe('analysing a run', () => {
  it('sees a clean full-throttle finish of the first track', () => {
    const facts = analyseRun(intro, 0, new Uint8Array(1500).fill(inputCode(1, 0)));
    expect(facts).toMatchObject({ finished: true, braked: false, coasted: false, leaned: false, crashedAt: null });
    // Slopes alone come nowhere near a full turn.
    expect(facts.turns).toBeLessThan(0.6);
  });

  it('notes braking, coasting and leaning once the race is on', () => {
    const inputs = new Uint8Array(1500).fill(inputCode(1, 0));
    inputs.fill(inputCode(-1, 1), 200, 215);
    const facts = analyseRun(intro, 0, inputs);
    expect(facts).toMatchObject({ braked: true, coasted: true, leaned: true });
  });

  it('notes when the rider went down', () => {
    // Leaning back under full throttle from the start throws the bike over.
    const facts = analyseRun(intro, 3, new Uint8Array(600).fill(inputCode(1, -1)));
    expect(facts.finished).toBe(false);
    expect(facts.crashedAt).not.toBeNull();
  });
});

describe('achievements of a run', () => {
  it('gives the plain ones for a clean finish', () => {
    expect(runAchievements(clean, context)).toEqual(['noBrake', 'fullThrottle', 'noLean']);
  });

  it('does not give the trivial ones on an easy track, unless it is the daily one', () => {
    expect(runAchievements(clean, { ...context, level: 0 })).toEqual(['noBrake']);
    expect(runAchievements(clean, { ...context, level: 0, daily: true })).toEqual([
      'noBrake',
      'fullThrottle',
      'noLean',
    ]);
  });

  it('gives nothing but the instant crash to a run that did not finish', () => {
    const crashed = { ...clean, finished: false, crashedAt: 40 };
    expect(runAchievements(crashed, { ...context, wheelie: true })).toEqual(['instantCrash']);
    expect(runAchievements({ ...crashed, crashedAt: 500 }, context)).toEqual([]);
  });

  it('knows a wheelie, a flip and a win over the ghost', () => {
    const facts = { ...clean, braked: true, coasted: true, leaned: true, turns: 1.1 };
    expect(runAchievements(facts, { ...context, wheelie: true })).toEqual(['wheelie', 'flip']);
    expect(runAchievements(facts, { ...context, ghostTime: 10_500 })).toEqual(['flip', 'beatGhost']);
    expect(runAchievements({ ...facts, turns: 0 }, { ...context, ghostTime: 10_050 })).toEqual([
      'beatGhost',
      'photoFinish',
    ]);
    expect(runAchievements({ ...facts, turns: 0 }, { ...context, ghostTime: 10_000 })).toEqual([]);
  });
});

describe('keeping achievements', () => {
  beforeEach(() => removeAll('achievements'));

  it('awards each one once and remembers when', () => {
    expect(award(['wheelie', 'flip'], 1000)).toEqual(['wheelie', 'flip']);
    expect(award(['flip', 'shared'], 2000)).toEqual(['shared']);
    expect(earnedAchievements()).toEqual({ wheelie: 1000, flip: 1000, shared: 2000 });
  });

  it('counts runs', () => {
    expect(countRun()).toBe(1);
    expect(countRun()).toBe(2);
  });

  it('has a title and a description for every achievement in both languages', () => {
    for (const table of [STRINGS, RU]) {
      expect(Object.keys(table.achievementList).sort()).toEqual([...ACHIEVEMENTS].sort());
      for (const id of ACHIEVEMENTS) {
        expect(table.achievementList[id][0].length).toBeGreaterThan(0);
        expect(table.achievementList[id][1].length).toBeGreaterThan(0);
      }
    }
  });
});
