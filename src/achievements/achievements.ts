import { readJson, writeJson } from '../storage/store';
import type { Strings } from '../ui/strings';
import type { RunFacts } from './analyse';

export type AchievementId = keyof Strings['achievementList'];

/** Every achievement, in the order the list shows them. */
export const ACHIEVEMENTS: readonly AchievementId[] = [
  'wheelie',
  'noBrake',
  'fullThrottle',
  'noLean',
  'flip',
  'beatGhost',
  'photoFinish',
  'easyDone',
  'mediumDone',
  'hardDone',
  'league325',
  'daily3',
  'daily7',
  'runs100',
  'ownTrack',
  'shared',
  'instantCrash',
];

/** One second of 15 ms ticks. */
const INSTANT_CRASH_TICKS = 67;
/** Hundredths of a second: the margin of a photo finish against the ghost. */
const PHOTO_FINISH_MILLISECONDS = 100;
const KEY = 'achievements';

interface Stored {
  /** When each achievement was earned, in milliseconds since the Unix epoch. */
  earned: Partial<Record<AchievementId, number>>;
  /** Runs made on the original tracks and the daily track. */
  runs: number;
}

function load(): Stored {
  const stored = readJson<Partial<Stored>>(KEY);
  const earned: Stored['earned'] = {};
  if (typeof stored?.earned === 'object' && stored.earned !== null) {
    for (const id of ACHIEVEMENTS) {
      const when: unknown = stored.earned[id];
      if (typeof when === 'number') earned[id] = when;
    }
  }
  return { earned, runs: typeof stored?.runs === 'number' && stored.runs > 0 ? Math.floor(stored.runs) : 0 };
}

/** When each earned achievement was earned. */
export function earnedAchievements(): Partial<Record<AchievementId, number>> {
  return load().earned;
}

/** Marks achievements as earned. Returns the ones that are new. */
export function award(ids: readonly AchievementId[], now: number): AchievementId[] {
  const stored = load();
  const fresh = ids.filter((id) => stored.earned[id] === undefined);
  if (fresh.length === 0) return [];
  for (const id of fresh) stored.earned[id] = now;
  writeJson(KEY, stored);
  return fresh;
}

/** Counts one more run. Returns the total. */
export function countRun(): number {
  const stored = load();
  stored.runs++;
  writeJson(KEY, stored);
  return stored.runs;
}

/** Adds runs made elsewhere, as when a backup is read. Returns the total. */
export function addRuns(count: number): number {
  const stored = load();
  stored.runs += Math.max(0, Math.floor(count));
  writeJson(KEY, stored);
  return stored.runs;
}

export interface RunContext {
  /** 0 easy, 1 medium, 2 hard. */
  level: number;
  /** The run was made on the daily track. */
  daily: boolean;
  /** The front wheel never touched the ground. */
  wheelie: boolean;
  /** Race time in milliseconds. */
  time: number;
  /** Finish time of the ghost that was raced, in milliseconds, or null. */
  ghostTime: number | null;
}

/**
 * The achievements a single run earns. The ones that are trivial on the gentlest tracks ask for
 * a medium or hard track, or the daily one.
 */
export function runAchievements(facts: RunFacts, context: RunContext): AchievementId[] {
  const earned: AchievementId[] = [];
  if (facts.crashedAt !== null && facts.crashedAt <= INSTANT_CRASH_TICKS) earned.push('instantCrash');
  if (!facts.finished) return earned;
  const demanding = context.level > 0 || context.daily;
  if (context.wheelie) earned.push('wheelie');
  if (!facts.braked) earned.push('noBrake');
  if (!facts.coasted && demanding) earned.push('fullThrottle');
  if (!facts.leaned && demanding) earned.push('noLean');
  if (facts.turns >= 0.95) earned.push('flip');
  if (context.ghostTime !== null && context.time < context.ghostTime) {
    earned.push('beatGhost');
    if (context.ghostTime - context.time <= PHOTO_FINISH_MILLISECONDS) earned.push('photoFinish');
  }
  return earned;
}
