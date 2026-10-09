import { defineConfig, devices } from '@playwright/test';
import base from './playwright.config';

/** Opt-in local regression; the regular CI configuration does not select these extra scenarios. */
export default defineConfig({
  ...base,
  projects: [
    ...(base.projects ?? []).filter((project) => project.name !== 'determinism-firefox'),
    ...(['Desktop Chrome', 'Desktop Safari'] as const).map((device, index) => ({
      name: index === 0 ? 'local-chromium' : 'local-webkit',
      testMatch: 'regression.spec.ts',
      use: { ...devices[device], baseURL: 'http://localhost:4174' },
    })),
  ],
  webServer: (Array.isArray(base.webServer) ? base.webServer : []).map((server) => ({
    ...server,
    reuseExistingServer: false,
  })),
  reporter: [['list'], ['html', { open: 'never', outputFolder: 'playwright-report/local' }]],
  use: { screenshot: 'only-on-failure', trace: 'retain-on-failure' },
});
