import { readdirSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { InvalidTrackError, Sim } from '../core/sim';
import { buildPack } from './pack';

const DIR = 'mods-src/packs';

// Every mirrored pack is put through the same code a player's install goes through, and every
// track is put on the start line and ridden for a moment.
it('mirrored packs load and their tracks can be started', () => {
  const unreadable: string[] = [];
  const unstartable: string[] = [];
  let tracks = 0;
  for (const file of readdirSync(DIR)) {
    let pack: ReturnType<typeof buildPack>;
    try {
      pack = buildPack(file, file, '', new Uint8Array(readFileSync(`${DIR}/${file}`)));
    } catch {
      unreadable.push(file);
      continue;
    }
    pack.levels.forEach((level, levelIndex) => {
      level.forEach((track, trackIndex) => {
        tracks++;
        try {
          const sim = new Sim({ track: track.data, league: 0, demo: false });
          for (let tick = 0; tick < 20; tick++) sim.step(1, 0);
        } catch (error) {
          // A few packs contain placeholder tracks with no ground at all; the game reports those as
          // damaged. Anything else would be a fault in the port.
          if (!(error instanceof InvalidTrackError)) throw error;
          unstartable.push(`${file} ${levelIndex}/${trackIndex}`);
        }
      });
    });
  }
  console.info(`${tracks} tracks; unreadable packs: ${unreadable.length}; unstartable tracks: ${unstartable.length}`);
  expect(tracks).toBeGreaterThan(10_000);
  expect(unreadable).toEqual(['699.mrg']);
  expect(unstartable.length).toBeLessThan(tracks / 1000);
}, 120_000);
