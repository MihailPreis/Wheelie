import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { InvalidPackError, parsePackHeader, parseTrack } from './mrg';

const original = new Uint8Array(readFileSync('public/assets/levels/levels.mrg'));

describe('parsePackHeader', () => {
  it('reads the original pack', () => {
    const header = parsePackHeader(original);
    expect(header.levels.map((level) => level.length)).toEqual([10, 10, 10]);
    for (const level of header.levels) {
      for (const track of level) {
        expect(track.name.length).toBeGreaterThan(0);
        expect(track.offset).toBeGreaterThan(0);
        expect(track.offset).toBeLessThan(original.length);
      }
    }
  });

  it('replaces underscores in names with spaces', () => {
    const names = parsePackHeader(original)
      .levels.flat()
      .map((track) => track.name);
    expect(names.some((name) => name.includes('_'))).toBe(false);
  });

  it('decodes CP-1251 names', () => {
    // One track in the easy level named "Тест_1", empty other levels.
    const name = [0xd2, 0xe5, 0xf1, 0xf2, 0x5f, 0x31, 0];
    const bytes = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 99, ...name, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parsePackHeader(bytes).levels[0]).toEqual([{ name: 'Тест 1', offset: 99 }]);
  });

  it('decodes the non-Cyrillic upper half of CP-1251', () => {
    const name = [0xa8, 0xb8, 0xb9, 0x80, 0xbf, 0xc0, 0xff, 0];
    const bytes = new Uint8Array([0, 0, 0, 1, 0, 0, 0, 1, ...name, 0, 0, 0, 0, 0, 0, 0, 0]);
    expect(parsePackHeader(bytes).levels[0]?.[0]?.name).toBe('Ёё№ЂїАя');
  });

  it('rejects absurd track counts and truncated headers', () => {
    expect(() => parsePackHeader(new Uint8Array([0x7f, 0, 0, 0]))).toThrow(InvalidPackError);
    expect(() => parsePackHeader(original.subarray(0, 50))).toThrow(InvalidPackError);
  });
});

describe('parseTrack', () => {
  const header = parsePackHeader(original);

  it('reads every track of the original pack', () => {
    for (const track of header.levels.flat()) {
      const data = parseTrack(original, track.offset);
      expect(data.truncated, track.name).toBe(false);
      expect(data.pointCount, track.name).toBeGreaterThan(10);
      expect(data.finishX, track.name).toBeGreaterThan(data.startX);
      for (let i = 1; i < data.pointCount; i++) {
        expect(data.points[i * 2] as number).toBeGreaterThan(data.points[i * 2 - 2] as number);
      }
    }
  });

  it('keeps what was read when the data is cut short', () => {
    const first = header.levels[0]?.[0];
    if (!first) throw new Error('missing track');
    const full = parseTrack(original, first.offset);
    const cut = parseTrack(original.subarray(0, first.offset + 40), first.offset);
    expect(cut.truncated).toBe(true);
    expect(cut.pointCount).toBeGreaterThan(0);
    expect(cut.pointCount).toBeLessThan(full.pointCount);
    expect(cut.startX).toBe(full.startX);
  });

  it('does not throw on garbage', () => {
    const garbage = new Uint8Array(64).fill(0xff);
    expect(() => parseTrack(garbage, 0)).not.toThrow();
    expect(() => parseTrack(garbage, 1000)).not.toThrow();
  });
});
