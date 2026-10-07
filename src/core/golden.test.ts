import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { type Scenario, verifyScenarios } from './verify';

// Every scenario recorded from the original Java physics must be reproduced bit for bit.

const GOLDEN_DIR = 'tests/golden';
const PACK_FILES: Record<string, string> = { original: 'public/assets/levels/levels.mrg' };

describe('golden traces', () => {
  const files = readdirSync(GOLDEN_DIR).filter((name) => name.endsWith('.jsonl'));

  it('exist', () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    it(`${file} matches the original physics`, () => {
      const scenarios = readFileSync(`${GOLDEN_DIR}/${file}`, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((line) => JSON.parse(line) as Scenario);
      expect(scenarios.length).toBeGreaterThan(0);

      const packFile = PACK_FILES[file.replace(/\.jsonl$/, '')];
      if (!packFile) throw new Error(`No pack registered for ${file}`);
      expect(verifyScenarios(new Uint8Array(readFileSync(packFile)), scenarios)).toEqual([]);
    });
  }
});
