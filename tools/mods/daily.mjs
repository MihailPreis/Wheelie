// Chooses the tracks that may come up as the daily track and writes them to mods-src/daily.json.
// A track qualifies if the game's own demo rider gets to the finish in every league within a
// sensible time: that rules out broken, unfinished and absurdly hard or long tracks.
// Run by hand after the mirror changes; the result is committed.
import { readFile, writeFile } from 'node:fs/promises';
import { createServer } from 'vite';

const SOURCE = new URL('../../mods-src/', import.meta.url);
/** Packs considered, most popular first. */
const PACKS = 300;
/** Tracks considered per level of a pack. */
const TRACKS_PER_LEVEL = 10;
/** Longest the demo rider may take: 45 seconds of 15 ms ticks. */
const MAX_TICKS = 3000;
/** Shortest run worth a day: 5 seconds. */
const MIN_TICKS = 330;
const LEAGUES = [0, 1, 2];

// Vite loads the game's TypeScript modules as the game itself does.
const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
const { Sim, Status } = await server.ssrLoadModule('/src/core/sim.ts');
const { parsePackHeader, parseTrack } = await server.ssrLoadModule('/src/formats/mrg.ts');

function rides(track, league) {
  try {
    const sim = new Sim({ track, league, demo: true });
    for (let tick = 0; tick < MAX_TICKS; tick++) {
      const status = sim.step(0, 0);
      if (status === Status.Finished || status === Status.FinishedLate) return tick >= MIN_TICKS;
      if (status === Status.Broken || status === Status.Crashed) return false;
    }
  } catch {
    // Not a track to offer.
  }
  return false;
}

const catalogue = JSON.parse(await readFile(new URL('catalog.json', SOURCE), 'utf8'));
const popular = catalogue
  .filter((pack) => pack.rank !== null)
  .sort((a, b) => a.rank - b.rank)
  .slice(0, PACKS);
const chosen = [];
let seen = 0;
for (const pack of popular) {
  let levels;
  let bytes;
  try {
    bytes = new Uint8Array(await readFile(new URL(`packs/${pack.id}.mrg`, SOURCE)));
    levels = parsePackHeader(bytes).levels;
  } catch {
    continue;
  }
  levels.forEach((level, levelIndex) => {
    level.slice(0, TRACKS_PER_LEVEL).forEach((entry, trackIndex) => {
      seen++;
      const track = parseTrack(bytes, entry.offset);
      if (LEAGUES.every((league) => rides(track, league))) chosen.push([pack.id, levelIndex, trackIndex]);
    });
  });
}
await server.close();
await writeFile(new URL('daily.json', SOURCE), `${JSON.stringify(chosen)}\n`);
console.log(`${chosen.length} of ${seen} tracks qualify`);
