import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  encodePack,
  encodeTrack,
  encodeTrackName,
  InvalidPackError,
  parsePackHeader,
  parseTrack,
  type TrackData,
} from './mrg';

const read = (bytes: Uint8Array) =>
  parsePackHeader(bytes).levels.map((level) =>
    level.map((entry) => ({ name: entry.name, data: parseTrack(bytes, entry.offset) })),
  );

const track = (points: number[], extra: Partial<TrackData> = {}): TrackData => ({
  startX: 16384,
  startY: 8192,
  finishX: 819200,
  finishY: 0,
  points: Int32Array.from(points.map((value) => value * 8192)),
  pointCount: points.length / 2,
  truncated: false,
  ...extra,
});

describe('writing level packs', () => {
  it('writes tracks that read back the same, with small and large steps', () => {
    const data = track([-50, 0, 10, 5, 137, -4, 138, 200, 265, 200, 30000, -30000]);
    expect(parseTrack(encodeTrack(data), 0)).toEqual(data);
  });

  it('rejects what the format cannot hold', () => {
    expect(() => encodeTrack(track([0, 0, 40000, 0]))).toThrow(InvalidPackError);
    expect(() => encodeTrack({ ...track([0, 0, 10, 0]), points: Int32Array.from([0, 0, 100, 0]) })).toThrow(
      InvalidPackError,
    );
    expect(() => encodeTrack(track([]))).toThrow(InvalidPackError);
  });

  it('encodes names as the original reads them', () => {
    expect(encodeTrackName('My track')).toEqual([...'My_track'].map((char) => char.charCodeAt(0)));
    expect(encodeTrackName('Трасса №1')).toEqual([0xd2, 0xf0, 0xe0, 0xf1, 0xf1, 0xe0, 0x5f, 0xb9, 0x31]);
    expect(encodeTrackName('x'.repeat(60))).toHaveLength(39);
    expect(encodeTrackName('日本')).toEqual([0x3f, 0x3f]);
  });

  it('writes a pack that reads back the same', () => {
    const levels = [
      [{ name: 'One', data: track([0, 0, 10, 3]) }],
      [],
      [
        { name: 'Вторая трасса', data: track([0, 0, 500, 3, 501, 9]) },
        { name: '', data: track([5, 5, 6, 6]) },
      ],
    ];
    expect(read(encodePack(levels))).toEqual(levels);
  });

  // The whole mirrored catalogue goes through the writer: whatever the game can read, it can write.
  it('round-trips every mirrored pack', () => {
    let packs = 0;
    for (const file of readdirSync('mods-src/packs')) {
      let levels: ReturnType<typeof read>;
      try {
        levels = read(new Uint8Array(readFileSync(`mods-src/packs/${file}`)));
      } catch {
        continue;
      }
      // Tracks with no points at all cannot be written; nothing can ride them either.
      const writable = levels.map((level) => level.filter((entry) => entry.data.pointCount > 0));
      const again = read(encodePack(writable));
      const clean = writable.map((level) =>
        level.map((entry) => ({ ...entry, data: { ...entry.data, truncated: false } })),
      );
      expect(again, file).toEqual(clean);
      packs++;
    }
    expect(packs).toBeGreaterThan(900);
  }, 120_000);
});
