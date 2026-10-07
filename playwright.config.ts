import { defineConfig, devices } from '@playwright/test';

// The production build, for tests of the app as shipped.
const previewPort = 4173;
// The dev server, which serves source modules directly, for tests that load the core on its own.
const devPort = 4174;
const dev = { baseURL: `http://localhost:${devPort}` };

export default defineConfig({
  testDir: 'tests/e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  projects: [
    {
      name: 'app',
      testMatch: 'smoke.spec.ts',
      use: { ...devices['Desktop Chrome'], baseURL: `http://localhost:${previewPort}` },
    },
    { name: 'flow', testMatch: 'flow.spec.ts', use: { ...devices['Desktop Chrome'], ...dev } },
    { name: 'determinism-chromium', testMatch: 'determinism.spec.ts', use: { ...devices['Desktop Chrome'], ...dev } },
    { name: 'determinism-firefox', testMatch: 'determinism.spec.ts', use: { ...devices['Desktop Firefox'], ...dev } },
    { name: 'determinism-webkit', testMatch: 'determinism.spec.ts', use: { ...devices['Desktop Safari'], ...dev } },
  ],
  webServer: [
    {
      command: `pnpm build && pnpm preview --port ${previewPort} --strictPort`,
      url: `http://localhost:${previewPort}`,
      reuseExistingServer: !process.env.CI,
    },
    {
      // The link service is stood in for by the tests; the address only has to be set.
      command: `VITE_SHORT_LINK_API=https://links.test pnpm dev --port ${devPort} --strictPort`,
      url: `http://localhost:${devPort}`,
      reuseExistingServer: !process.env.CI,
    },
  ],
});
