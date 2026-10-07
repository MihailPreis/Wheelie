import { readJson, removeAll, writeJson } from '../storage/store';

/**
 * The three best times per track and league (`Storage/HighScores.java`). Times are in
 * centiseconds, as the original stores them.
 */

export interface Score {
  name: string;
  time: number;
}

/** Best times of one track: up to three scores for each of the four leagues. */
export type TrackScores = Score[][];

export const PLACES = 3;
const LEAGUES = 4;
const MAX_TIME = 0xffff28;

export function emptyScores(): TrackScores {
  return Array.from({ length: LEAGUES }, () => []);
}

/** The place a time would take, 0–2, or 3 if it does not make the table. */
export function placeOf(scores: TrackScores, league: number, time: number): number {
  const list = scores[league] ?? [];
  for (let place = 0; place < PLACES; place++) {
    const score = list[place];
    if (!score || score.time > time) return place;
  }
  return PLACES;
}

/** Inserts a time if it makes the table. Returns the place it took, or 3. */
export function addScore(scores: TrackScores, league: number, name: string, time: number): number {
  const place = placeOf(scores, league, time);
  if (place === PLACES) return place;
  const list = scores[league] ?? [];
  list.splice(place, 0, { name, time: Math.min(time, MAX_TIME) });
  list.length = Math.min(list.length, PLACES);
  scores[league] = list;
  return place;
}

/** `mm:ss.cc`, the format of the score tables and the finished screen. */
export function formatScoreTime(centiseconds: number): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  const seconds = Math.floor(centiseconds / 100);
  return `${pad(Math.floor(seconds / 60))}:${pad(seconds % 60)}.${pad(centiseconds % 100)}`;
}

const prefix = (packId: string) => `scores.${packId}.`;
const key = (packId: string, level: number, track: number) => `${prefix(packId)}${level}.${track}`;

export function loadScores(packId: string, level: number, track: number): TrackScores {
  const scores = emptyScores();
  const stored = readJson<unknown>(key(packId, level, track));
  if (!Array.isArray(stored)) return scores;
  for (let league = 0; league < LEAGUES; league++) {
    const list: unknown = stored[league];
    if (!Array.isArray(list)) continue;
    for (const entry of list.slice(0, PLACES) as unknown[]) {
      if (typeof entry !== 'object' || entry === null) continue;
      const { name, time } = entry as Partial<Score>;
      if (typeof name === 'string' && typeof time === 'number' && Number.isFinite(time) && time > 0) {
        scores[league]?.push({ name: name.slice(0, 3), time: Math.floor(time) });
      }
    }
    scores[league]?.sort((a, b) => a.time - b.time);
  }
  return scores;
}

export function saveScores(packId: string, level: number, track: number, scores: TrackScores): void {
  writeJson(key(packId, level, track), scores);
}

/** Erases every score of a pack. */
export function clearScores(packId: string): void {
  removeAll(prefix(packId));
}
