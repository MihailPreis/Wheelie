// Builds the game and zips it for upload to itch.io as an HTML5 game.
//
// itch.io runs the game in a frame on its own domain, where the address of the page — and with it
// a link to a replay — never reaches the game. Replay links must therefore point at the copy
// hosted elsewhere, and VITE_SHARE_BASE_URL has to say where that is.
import { execFileSync } from 'node:child_process';
import { mkdirSync, readdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** itch.io refuses archives with more files or more unpacked data than this. */
const MAX_FILES = 1000;
const MAX_BYTES = 500 * 1024 * 1024;

const root = fileURLToPath(new URL('..', import.meta.url));
const shareBase = process.env.VITE_SHARE_BASE_URL?.trim();
if (!shareBase || !/^https:\/\//.test(shareBase)) {
  console.error(
    'Set VITE_SHARE_BASE_URL to the https address the game is hosted at outside itch.io,\n' +
      'for example: VITE_SHARE_BASE_URL=https://mihailpreis.github.io/Wheelie/ pnpm package:itch',
  );
  process.exit(1);
}

execFileSync('pnpm', ['build'], { cwd: root, stdio: 'inherit' });

const files = readdirSync(`${root}dist`, { recursive: true, withFileTypes: true }).filter((entry) => entry.isFile());
const bytes = files.reduce((total, entry) => total + statSync(`${entry.parentPath}/${entry.name}`).size, 0);
if (files.length > MAX_FILES || bytes > MAX_BYTES) {
  console.error(
    `The build has ${files.length} files and ${bytes} bytes; itch.io allows ${MAX_FILES} and ${MAX_BYTES}.`,
  );
  process.exit(1);
}

const { version } = JSON.parse(readFileSync(`${root}package.json`, 'utf8'));
const out = `${root}itch/wheelie-${version}.zip`;
mkdirSync(`${root}itch`, { recursive: true });
rmSync(out, { force: true });
// index.html has to sit at the top of the archive.
execFileSync('zip', ['-q', '-r', '-X', out, '.'], { cwd: `${root}dist`, stdio: 'inherit' });
console.log(`${out}: ${files.length} files, ${(statSync(out).size / 1024 / 1024).toFixed(1)} MB zipped`);
