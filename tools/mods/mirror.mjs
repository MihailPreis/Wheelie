// Mirrors the level pack catalogue of gdtr.net into mods-src/. Run by hand; the result is committed.
// Files that are already there are kept, so an interrupted run can simply be started again.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';

const API = 'https://gdtr.net/api.php?v=2&method=getLevels';
const FILE = (id) => `https://gdtr.net/mrg/${id}.mrg`;
const OUT = new URL('../../mods-src/', import.meta.url);
const PAGE = 100;
const PAUSE_MILLISECONDS = 200;

const pause = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function attempt(work) {
  for (let tries = 1; ; tries++) {
    try {
      return await work();
    } catch (error) {
      if (tries === 4) throw error;
      await pause(2000 * tries);
    }
  }
}

async function page(sort, offset) {
  return attempt(async () => {
    const response = await fetch(`${API}&sort=${sort}&offset=${offset}&limit=${PAGE}`);
    if (!response.ok) throw new Error(`Catalogue request failed: ${response.status}`);
    const [status, body] = await response.json();
    if (status !== 'ok') throw new Error(`Catalogue answered "${status}"`);
    return body;
  });
}

/** Every pack listed under one sort order, in that order. Paging skips and repeats entries. */
async function list(sort) {
  const items = [];
  let count = Infinity;
  for (let offset = 0; offset < count; offset += PAGE) {
    const body = await page(sort, offset);
    count = body.count;
    items.push(...body.items);
    await pause(PAUSE_MILLISECONDS);
  }
  return { count, items };
}

await mkdir(new URL('packs/', OUT), { recursive: true });

const packs = new Map();
let count = 0;
// Each order misses a few packs the others have; the popular one also gives the ranking.
for (const sort of ['popular', 'oldest', 'recent', 'tracks']) {
  const listed = await list(sort);
  count = Math.max(count, listed.count);
  listed.items.forEach((item, index) => {
    const known = packs.get(item.id);
    if (!known) {
      packs.set(item.id, {
        id: item.id,
        name: item.name,
        author: item.author?.name ?? '',
        tracks: item.tracks,
        added: item.added,
        size: item.size,
        rank: sort === 'popular' ? index : null,
      });
    }
  });
  console.log(`${sort}: ${listed.items.length} listed, ${packs.size} distinct of ${count}`);
  if (sort !== 'popular' && packs.size >= count) break;
}

const catalogue = [...packs.values()].sort((a, b) => a.id - b.id);
const missing = [];
let fetched = 0;
for (const pack of catalogue) {
  const target = new URL(`packs/${pack.id}.mrg`, OUT);
  if (existsSync(target)) continue;
  try {
    const bytes = await attempt(async () => {
      const response = await fetch(FILE(pack.id));
      if (response.status === 404) return null;
      if (!response.ok) throw new Error(`Pack ${pack.id}: ${response.status}`);
      return new Uint8Array(await response.arrayBuffer());
    });
    if (bytes) {
      await writeFile(target, bytes);
      fetched++;
    } else {
      missing.push(pack.id);
    }
  } catch (error) {
    console.warn(String(error));
    missing.push(pack.id);
  }
  await pause(PAUSE_MILLISECONDS);
}

await writeFile(new URL('catalog.json', OUT), `${JSON.stringify(catalogue, null, 1)}\n`);
console.log(`${catalogue.length} packs in the catalogue (the site reports ${count}), ${fetched} downloaded now`);
if (missing.length) console.log(`No file for: ${missing.join(', ')}`);
