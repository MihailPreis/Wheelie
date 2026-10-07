import { describe, expect, it } from 'vitest';
import { parseCatalog, sortPacks } from './catalog';

const row = (id: number, added: number, tracks: number[], rank: number, extra: unknown[] = []) => [
  id,
  `Pack ${id}`,
  'someone',
  added,
  tracks,
  rank,
  0,
  id * 10,
  10,
  'abcdef0123456789',
  0,
  ...extra,
];
const catalogue = (packs: unknown[]) => ({ version: 1, chunks: ['chunk-00.bin'], packs });

describe('parseCatalog', () => {
  it('reads rows into packs', () => {
    const [pack] = parseCatalog(catalogue([row(7, 1000, [1, 2, 3], 4)]));
    expect(pack).toEqual({
      id: 7,
      name: 'Pack 7',
      author: 'someone',
      added: 1000,
      tracks: [1, 2, 3],
      rank: 4,
      chunk: 'chunk-00.bin',
      offset: 70,
      size: 10,
      hash: 'abcdef0123456789',
      broken: false,
    });
  });

  it('rejects an unknown format', () => {
    expect(() => parseCatalog(null)).toThrow();
    expect(() => parseCatalog({ version: 2, chunks: [], packs: [] })).toThrow();
  });

  it('drops rows that cannot be trusted', () => {
    const bad = [
      'nonsense',
      [1],
      row(-1, 0, [1, 1, 1], 0),
      row(2, 0, [1, 1], 0),
      row(3, 0, [1, 1, 1.5], 0),
      // A chunk the catalogue does not list.
      [4, 'x', 'y', 0, [1, 1, 1], 0, 5, 0, 10, 'h', 0],
    ];
    expect(parseCatalog(catalogue(bad))).toEqual([]);
  });

  it('refuses chunk names that could point outside the mods folder', () => {
    const json = { version: 1, chunks: ['../secret'], packs: [row(1, 0, [1, 1, 1], 0)] };
    expect(parseCatalog(json)).toEqual([]);
  });
});

describe('sortPacks', () => {
  const packs = parseCatalog(
    catalogue([row(1, 300, [1, 0, 0], 2), row(2, 100, [5, 5, 5], -1), row(3, 200, [2, 2, 0], 0)]),
  );
  const ids = (order: Parameters<typeof sortPacks>[1]) => sortPacks(packs, order).map((pack) => pack.id);

  it('orders by popularity with unranked packs last', () => expect(ids('popular')).toEqual([3, 1, 2]));
  it('orders by date', () => {
    expect(ids('recent')).toEqual([1, 3, 2]);
    expect(ids('oldest')).toEqual([2, 3, 1]);
  });
  it('orders by track count', () => expect(ids('tracks')).toEqual([2, 3, 1]));
});
