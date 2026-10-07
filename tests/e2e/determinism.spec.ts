import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

// The simulation must give identical results in every browser engine. This replays the traces
// recorded from the original Java physics inside the browser under test.

test('simulation reproduces the golden traces in this engine', async ({ page }) => {
  const scenarios = readFileSync('tests/golden/original.jsonl', 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line));

  await page.goto('/');
  await page.addScriptTag({
    type: 'module',
    content: `
      import { verifyScenarios } from '/src/core/verify.ts';
      window.__verifyScenarios = verifyScenarios;
    `,
  });
  await page.waitForFunction(() => '__verifyScenarios' in window);

  const failures = await page.evaluate(async (recorded) => {
    const response = await fetch('/assets/levels/levels.mrg');
    const pack = new Uint8Array(await response.arrayBuffer());
    const verify = (window as unknown as { __verifyScenarios: (pack: Uint8Array, s: unknown[]) => string[] })
      .__verifyScenarios;
    return verify(pack, recorded);
  }, scenarios);

  expect(scenarios.length).toBeGreaterThan(200);
  expect(failures).toEqual([]);
});
