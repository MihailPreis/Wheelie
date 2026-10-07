import { parsePackHeader, parseTrack, type TrackData } from '../formats/mrg';

export const ORIGINAL_PACK_ID = 'original';

/** A level pack ready to play. */
export interface Pack {
  /** Stable identifier; progress and high scores are stored under it. */
  id: string;
  name: string;
  author: string;
  /** Tracks of the easy, medium and hard levels. */
  levels: { name: string; data: TrackData }[][];
}

/**
 * Reads a whole `.mrg` file. Throws if the file is not a level pack. A pack whose track data is
 * damaged somewhere is not accepted either: a track that cannot be loaded would block the ones
 * behind it from ever being unlocked.
 */
export function buildPack(id: string, name: string, author: string, bytes: Uint8Array): Pack {
  const levels = parsePackHeader(bytes).levels.map((level) =>
    level.map((entry) => ({ name: entry.name, data: parseTrack(bytes, entry.offset) })),
  );
  return { id, name, author, levels };
}
