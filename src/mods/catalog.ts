/**
 * The catalogue of community level packs bundled with the game (mirrored from gdtr.net). Nothing
 * here is loaded until the player opens the list; a pack's bytes come out of a shared chunk file.
 */

export interface CatalogPack {
  /** Identifier of the pack on gdtr.net. */
  id: number;
  name: string;
  author: string;
  /** When the pack was published, in seconds since the Unix epoch. */
  added: number;
  /** Number of tracks in the easy, medium and hard levels. */
  tracks: readonly [number, number, number];
  /** Position in the popularity ranking, 0 first; -1 if unranked. */
  rank: number;
  chunk: string;
  offset: number;
  size: number;
  /** First 16 hex digits of the SHA-256 of the pack file. */
  hash: string;
  /** The pack file could not be read when the catalogue was built. */
  broken: boolean;
}

export const SORT_ORDERS = ['popular', 'recent', 'oldest', 'tracks'] as const;
export type SortOrder = (typeof SORT_ORDERS)[number];

export const trackTotal = (pack: CatalogPack) => pack.tracks[0] + pack.tracks[1] + pack.tracks[2];

const count = (value: unknown) => (typeof value === 'number' && Number.isInteger(value) && value >= 0 ? value : null);

/** Reads `catalog.json`. Rows that do not make sense are dropped rather than trusted. */
export function parseCatalog(json: unknown): CatalogPack[] {
  if (typeof json !== 'object' || json === null) throw new Error('The catalogue is not an object');
  const { version, chunks, packs } = json as { version?: unknown; chunks?: unknown; packs?: unknown };
  if (version !== 1 || !Array.isArray(chunks) || !Array.isArray(packs)) throw new Error('Unknown catalogue format');
  const result: CatalogPack[] = [];
  for (const row of packs as unknown[]) {
    if (!Array.isArray(row)) continue;
    const [id, name, author, added, tracks, rank, chunk, offset, size, hash, broken] = row as unknown[];
    const file: unknown = chunks[count(chunk) ?? -1];
    const counts = Array.isArray(tracks) ? tracks.map(count) : [];
    const [easy, medium, hard] = counts;
    if (
      count(id) === null ||
      typeof name !== 'string' ||
      typeof file !== 'string' ||
      !/^[\w.-]+$/.test(file) ||
      count(offset) === null ||
      count(size) === null ||
      typeof hash !== 'string' ||
      easy == null ||
      medium == null ||
      hard == null
    ) {
      continue;
    }
    result.push({
      id: id as number,
      name,
      author: typeof author === 'string' ? author : '',
      added: count(added) ?? 0,
      tracks: [easy, medium, hard],
      rank: typeof rank === 'number' ? rank : -1,
      chunk: file,
      offset: offset as number,
      size: size as number,
      hash,
      broken: broken === 1,
    });
  }
  return result;
}

export function sortPacks(packs: readonly CatalogPack[], order: SortOrder): CatalogPack[] {
  const unranked = (pack: CatalogPack) => (pack.rank < 0 ? Number.MAX_SAFE_INTEGER : pack.rank);
  const compare: Record<SortOrder, (a: CatalogPack, b: CatalogPack) => number> = {
    popular: (a, b) => unranked(a) - unranked(b) || a.id - b.id,
    recent: (a, b) => b.added - a.added || b.id - a.id,
    oldest: (a, b) => a.added - b.added || a.id - b.id,
    tracks: (a, b) => trackTotal(b) - trackTotal(a) || a.id - b.id,
  };
  return [...packs].sort(compare[order]);
}

export async function loadCatalog(baseUrl: string): Promise<CatalogPack[]> {
  const response = await fetch(`${baseUrl}assets/mods/catalog.json`);
  if (!response.ok) throw new Error(`The catalogue is unavailable (${response.status})`);
  return parseCatalog(await response.json());
}

/** Fetches the chunk a pack lives in and cuts the pack out of it. */
export async function downloadPack(baseUrl: string, pack: CatalogPack): Promise<Uint8Array> {
  const response = await fetch(`${baseUrl}assets/mods/${pack.chunk}`);
  if (!response.ok) throw new Error(`The pack is unavailable (${response.status})`);
  const chunk = new Uint8Array(await response.arrayBuffer());
  if (pack.offset + pack.size > chunk.length) throw new Error('The pack lies outside its chunk');
  return chunk.slice(pack.offset, pack.offset + pack.size);
}

/** Packs whose name or author contains every word of the query. */
export function searchPacks(packs: readonly CatalogPack[], query: string): CatalogPack[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [...packs];
  return packs.filter((pack) => {
    const text = `${pack.name} ${pack.author}`.toLowerCase();
    return words.every((word) => text.includes(word));
  });
}
