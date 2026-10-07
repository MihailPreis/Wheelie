import { readJson, writeJson } from '../storage/store';
import { STRINGS } from '../ui/strings';

/**
 * The daily track: one track of the bundled level packs, the same for everyone on the same day.
 * There is no server behind it — the choice follows from the date alone.
 */

/** A track that may come up: pack number in the catalogue, level, track. */
export type Candidate = readonly [pack: number, level: number, track: number];

export interface DailyPick {
  /** Days since the Unix epoch, in UTC. */
  day: number;
  packId: string;
  level: number;
  track: number;
  league: number;
}

const DAY_MILLISECONDS = 86_400_000;
/** The daily track is ridden on one of the three leagues every player has or can earn early. */
const LEAGUES = 3;

/** The day a moment falls on. Days turn over at midnight UTC, at the same instant everywhere. */
export const dayOf = (milliseconds: number) => Math.floor(milliseconds / DAY_MILLISECONDS);

export const dayLabel = (day: number) =>
  new Date(day * DAY_MILLISECONDS).toLocaleDateString(STRINGS.locale, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });

export function parseCandidates(json: unknown): Candidate[] {
  if (!Array.isArray(json)) throw new Error('The list of daily tracks is not a list');
  const whole = (value: unknown) => typeof value === 'number' && Number.isInteger(value) && value >= 0;
  return (json as unknown[]).filter(
    (row): row is Candidate => Array.isArray(row) && row.length === 3 && row.every(whole) && (row[1] as number) < 3,
  );
}

const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));

/**
 * The track of a day. Successive days step through the list by a stride that shares no factor
 * with its length, so no track comes back until every other one has had its day.
 */
export function pickDaily(candidates: readonly Candidate[], day: number): DailyPick | null {
  const count = candidates.length;
  if (count === 0) return null;
  let stride = Math.max(1, Math.floor(count * 0.618));
  while (gcd(stride, count) !== 1) stride++;
  const index = ((((day % count) * stride) % count) + count) % count;
  const [pack, level, track] = candidates[index] as Candidate;
  // A small hash of the day, so the league does not simply cycle in step with the week.
  const mixed = Math.imul(day ^ (day >>> 7), 0x9e3779b1) >>> 0;
  return { day, packId: `gdtr-${pack}`, level, track, league: (mixed >>> 16) % LEAGUES };
}

// ---- the player's results -----------------------------------------------------------------

const key = (day: number) => `daily.${day}`;

/** The player's best time on a day's track in milliseconds, or null if it was not finished. */
export function dailyBest(day: number): number | null {
  const stored = readJson<{ time?: unknown }>(key(day));
  return typeof stored?.time === 'number' && stored.time > 0 ? stored.time : null;
}

/** Records a finish. Returns true if it is the best of the day so far. */
export function recordDaily(day: number, time: number): boolean {
  const best = dailyBest(day);
  if (best !== null && best <= time) return false;
  writeJson(key(day), { time });
  return true;
}

/** Days in a row, ending with `day` or the day before it, on which the daily track was finished. */
export function dailyStreak(day: number): number {
  let last = dailyBest(day) !== null ? day : day - 1;
  let streak = 0;
  while (dailyBest(last) !== null) {
    streak++;
    last--;
  }
  return streak;
}
