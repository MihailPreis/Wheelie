import { readJson, writeJson } from '../storage/store';
import { STRINGS } from '../ui/strings';

/**
 * What the player has unlocked in one level pack, and what they last selected. The rules follow
 * `Menu.saveCompletedTrack` of the original.
 */
export interface Progress {
  /** Highest selectable track index per level; -1 while the level is locked. */
  unlockedTracks: [number, number, number];
  /** Highest selectable level index, 0–2. */
  unlockedLevels: number;
  /** Highest selectable league index, 0–3. */
  unlockedLeagues: number;
  selectedLevel: number;
  /** The track last selected in each level. */
  selectedTracks: [number, number, number];
  selectedLeague: number;
}

export const LEVEL_NAMES = STRINGS.levelNames;
export const LEAGUE_NAMES = ['100cc', '175cc', '220cc', '325cc'] as const;
/** Entering this name unlocks everything, as in the original. */
const CHEAT_NAME = 'RKE';

/** A new game: the first track of the two easier levels, the slowest league. */
export function initialProgress(): Progress {
  return {
    unlockedTracks: [0, 0, -1],
    unlockedLevels: 1,
    unlockedLeagues: 0,
    selectedLevel: 0,
    selectedTracks: [0, 0, 0],
    selectedLeague: 0,
  };
}

export function isCheatName(name: string): boolean {
  return name === CHEAT_NAME;
}

export function unlockEverything(progress: Progress, trackCounts: readonly number[]): void {
  progress.unlockedLeagues = 3;
  progress.unlockedLevels = 2;
  progress.unlockedTracks = [(trackCounts[0] ?? 1) - 1, (trackCounts[1] ?? 1) - 1, (trackCounts[2] ?? 1) - 1];
}

/** The leagues offered: the fourth stays hidden until it is unlocked. */
export function availableLeagues(progress: Progress): readonly string[] {
  return progress.unlockedLeagues < 3 ? LEAGUE_NAMES.slice(0, 3) : LEAGUE_NAMES;
}

export function canStart(progress: Progress, level: number, track: number, league: number): boolean {
  return (
    level <= progress.unlockedLevels &&
    track <= (progress.unlockedTracks[level] ?? -1) &&
    league <= progress.unlockedLeagues
  );
}

export interface Completion {
  /** The last track of the level was finished. */
  levelCompleted: boolean;
  /** Index of the league this run unlocked, if any. */
  leagueUnlocked: number | null;
  /** Every track of every level has been finished. */
  everythingCompleted: boolean;
}

/**
 * Records that a track was finished: unlocks the next track, and at the end of a level the next
 * league and level. Also moves the selection on to what should be played next.
 */
export function completeTrack(
  progress: Progress,
  level: number,
  track: number,
  trackCounts: readonly number[],
): Completion {
  const count = trackCounts[level] ?? 0;
  const tracks = progress.unlockedTracks;
  if ((tracks[level] ?? -1) >= track) tracks[level] = Math.max(tracks[level] ?? -1, track + 1);

  const result: Completion = { levelCompleted: false, leagueUnlocked: null, everythingCompleted: false };
  if (track === count - 1) {
    result.levelCompleted = true;
    // Finishing the easy, medium and hard levels unlocks leagues 1, 2 and 3.
    if (progress.unlockedLeagues < level + 1) {
      progress.unlockedLeagues = level + 1;
      result.leagueUnlocked = level + 1;
    }
    progress.unlockedLevels = Math.min(progress.unlockedLevels + 1, 2);
    tracks[level] = Math.min((tracks[level] ?? 0) + 1, count);
    if (tracks[progress.unlockedLevels] === -1) tracks[progress.unlockedLevels] = 0;

    if (level < 2) {
      progress.selectedLevel = level + 1;
      progress.selectedTracks[level + 1] = 0;
    }
    result.everythingCompleted = trackCounts.every((n, i) => (tracks[i] ?? -1) >= n - 1);
  } else {
    progress.selectedTracks[level] = track + 1;
  }
  return result;
}

/** How many tracks of a level count as completed, for the "N of M tracks" line. */
export function completedCount(progress: Progress, level: number, trackCounts: readonly number[]): number {
  return Math.max(0, Math.min(progress.unlockedTracks[level] ?? 0, trackCounts[level] ?? 0));
}

const key = (packId: string) => `progress.${packId}`;

/** Loads the progress for a pack, repairing anything that does not fit the pack's size. */
export function loadProgress(packId: string, trackCounts: readonly number[]): Progress {
  const fresh = initialProgress();
  const stored = readJson<Partial<Progress>>(key(packId));
  if (!stored) return fresh;

  const int = (value: unknown, low: number, high: number, fallback: number) =>
    typeof value === 'number' && Number.isInteger(value) ? Math.max(low, Math.min(high, value)) : fallback;
  const triple = (value: unknown, low: number, fallback: readonly number[]): [number, number, number] => {
    const list = Array.isArray(value) ? value : [];
    return [0, 1, 2].map((i) => int(list[i], low, trackCounts[i] ?? 0, fallback[i] ?? 0)) as [number, number, number];
  };

  const progress: Progress = {
    unlockedTracks: triple(stored.unlockedTracks, -1, fresh.unlockedTracks),
    unlockedLevels: int(stored.unlockedLevels, 0, 2, fresh.unlockedLevels),
    unlockedLeagues: int(stored.unlockedLeagues, 0, 3, fresh.unlockedLeagues),
    selectedLevel: int(stored.selectedLevel, 0, 2, 0),
    selectedTracks: triple(stored.selectedTracks, 0, fresh.selectedTracks),
    selectedLeague: int(stored.selectedLeague, 0, 3, 0),
  };
  for (let i = 0; i < 3; i++) {
    const last = Math.max(0, (trackCounts[i] ?? 1) - 1);
    progress.selectedTracks[i] = Math.min(progress.selectedTracks[i] ?? 0, last);
  }
  return progress;
}

export function saveProgress(packId: string, progress: Progress): void {
  writeJson(key(packId), progress);
}
