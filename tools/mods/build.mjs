// Packs the mirrored level packs of mods-src/ into the form the game loads:
// public/assets/mods/catalog.json and chunk-NN.bin. A file per pack would exceed the
// 1000-file limit of an itch.io upload, so packs are concatenated into chunks.
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { parsePackHeader, parseTrack } from '../../src/formats/mrg.ts';

const SOURCE = new URL('../../mods-src/', import.meta.url);
const OUT = new URL('../../public/assets/mods/', import.meta.url);
const CHUNK_BYTES = 1024 * 1024;

const catalogue = JSON.parse(await readFile(new URL('catalog.json', SOURCE), 'utf8'));
await rm(OUT, { recursive: true, force: true });
await mkdir(OUT, { recursive: true });

/** Track counts of the three levels, or null if the pack cannot be read. */
function inspect(bytes) {
  try {
    const header = parsePackHeader(bytes);
    for (const level of header.levels) for (const track of level) parseTrack(bytes, track.offset);
    return header.levels.map((level) => level.length);
  } catch {
    return null;
  }
}

const chunks = [];
let chunk = [];
let chunkBytes = 0;
const flush = async () => {
  if (chunk.length === 0) return;
  const name = `chunk-${String(chunks.length).padStart(2, '0')}.bin`;
  await writeFile(new URL(name, OUT), Buffer.concat(chunk));
  chunks.push(name);
  chunk = [];
  chunkBytes = 0;
};

const packs = [];
let broken = 0;
let absent = 0;
for (const pack of catalogue) {
  const file = new URL(`packs/${pack.id}.mrg`, SOURCE);
  if (!existsSync(file)) {
    absent++;
    continue;
  }
  const bytes = await readFile(file);
  const tracks = inspect(new Uint8Array(bytes));
  if (!tracks) broken++;
  // Rows rather than objects: a thousand packs repeat every key a thousand times.
  packs.push([
    pack.id,
    pack.name,
    pack.author,
    pack.added,
    tracks ?? pack.tracks,
    pack.rank ?? -1,
    chunks.length,
    chunkBytes,
    bytes.length,
    createHash('sha256').update(bytes).digest('hex').slice(0, 16),
    tracks ? 0 : 1,
  ]);
  chunk.push(bytes);
  chunkBytes += bytes.length;
  if (chunkBytes >= CHUNK_BYTES) await flush();
}
await flush();

await writeFile(new URL('catalog.json', OUT), JSON.stringify({ version: 1, chunks, packs }));
console.log(`${packs.length} packs in ${chunks.length} chunks; ${broken} unreadable, ${absent} without a file`);
