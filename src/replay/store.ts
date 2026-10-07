import { Outcome } from '../formats/replay';
import { Table } from '../storage/database';

/** A saved run: the encoded replay plus what the list of runs shows without decoding it. */
export interface StoredReplay {
  id: string;
  bytes: Uint8Array;
  packId: string;
  packName: string;
  level: number;
  track: number;
  league: number;
  trackName: string;
  player: string;
  /** Milliseconds since the Unix epoch. */
  date: number;
  outcome: Outcome;
  wheelie: boolean;
  /** Race time in milliseconds; 0 unless finished. */
  time: number;
}

/** Unfinished runs are kept only as a rolling window; finished ones stay until deleted. */
export const UNFINISHED_KEPT = 30;

function isStoredReplay(value: unknown): value is StoredReplay {
  const replay = value as Partial<StoredReplay> | null;
  if (typeof replay !== 'object' || replay === null || !(replay.bytes instanceof Uint8Array)) return false;
  const texts = [replay.id, replay.packId, replay.packName, replay.trackName, replay.player];
  const numbers = [replay.level, replay.track, replay.league, replay.date, replay.outcome, replay.time];
  return texts.every((text) => typeof text === 'string') && numbers.every((number) => typeof number === 'number');
}

/** The runs to drop so that no more than `kept` unfinished ones remain; the oldest go first. */
export function surplus(replays: readonly StoredReplay[], kept = UNFINISHED_KEPT): StoredReplay[] {
  const unfinished = replays.filter((replay) => replay.outcome !== Outcome.Finished).sort((a, b) => b.date - a.date);
  return unfinished.slice(kept);
}

export class ReplayStore {
  private readonly table = new Table('replays', isStoredReplay);
  private counter = 0;

  /** Saved runs, newest first. */
  async list(): Promise<StoredReplay[]> {
    return (await this.table.all()).sort((a, b) => b.date - a.date || (a.id < b.id ? 1 : -1));
  }

  async add(replay: Omit<StoredReplay, 'id'>): Promise<StoredReplay> {
    // Two runs can end within the same millisecond only in tests, but the key must still differ.
    const stored = { ...replay, id: `${replay.date.toString(36)}-${(this.counter++).toString(36)}` };
    await this.table.put(stored);
    for (const old of surplus(await this.table.all())) await this.table.delete(old.id);
    return stored;
  }

  delete(id: string): Promise<void> {
    return this.table.delete(id);
  }

  clear(): void {
    void this.table.clear();
  }
}
