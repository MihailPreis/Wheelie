// Regenerates tests/golden/*.jsonl by running the original Java physics headless.
// Needs a JDK on PATH and the reference sources (pnpm reference:fetch).
//
//   node tools/golden/generate.mjs                 regenerate the golden file
//   node tools/golden/generate.mjs --dump <index>  print the full per-tick state of one scenario
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REFERENCE = 'reference/src/org/happysanta/gd';
const ORIGINAL_SOURCES = [
  'Game/Physics.java',
  'Game/FPMath.java',
  'Game/k.java',
  'Levels/Loader.java',
  'Levels/Level.java',
  'Levels/Reader.java',
  'Levels/LevelHeader.java',
  'Levels/InvalidTrackException.java',
].map((file) => join(REFERENCE, file));

const PACKS = [{ name: 'original', file: 'public/assets/levels/levels.mrg' }];

if (!existsSync(REFERENCE)) {
  console.error('Reference sources are missing. Run: pnpm reference:fetch');
  process.exit(1);
}

const classes = mkdtempSync(join(tmpdir(), 'gd-golden-'));
try {
  execFileSync(
    'javac',
    [
      '-nowarn',
      '-d',
      classes,
      '-sourcepath',
      'tools/golden/stubs',
      ...ORIGINAL_SOURCES,
      'tools/golden/harness/Harness.java',
    ],
    { stdio: ['ignore', 'inherit', 'inherit'] },
  );

  const dumpAt = process.argv.indexOf('--dump');
  const extra = dumpAt >= 0 ? ['--dump', process.argv[dumpAt + 1]] : [];

  mkdirSync('tests/golden', { recursive: true });
  for (const pack of PACKS) {
    const output = execFileSync('java', ['-cp', classes, 'Harness', pack.file, pack.name, ...extra], {
      maxBuffer: 1 << 30,
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    if (dumpAt >= 0) {
      process.stdout.write(output);
    } else {
      const target = `tests/golden/${pack.name}.jsonl`;
      writeFileSync(target, output);
      console.log(`${target}: ${output.toString().trimEnd().split('\n').length} scenarios`);
    }
  }
} finally {
  rmSync(classes, { recursive: true, force: true });
}
