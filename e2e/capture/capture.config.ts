import { defineConfig } from '@playwright/test';

// Captures for the Zenn book (see README.md). Not part of the E2E suite:
// e2e/playwright.config.ts only reads e2e/tests. Outputs go to the git-ignored
// .local-docs/ so recordings never end up in a commit.

export default defineConfig({
  testDir: './tests',
  outputDir: '/app/.local-docs/playwright-capture/output/test-results',
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: `http://localhost:${process.env.WEB_PORT ?? '5173'}`,
    viewport: { width: 900, height: 640 },
    video: { mode: 'on', size: { width: 900, height: 640 } },
    launchOptions: { slowMo: 250 },
  },
  projects: [{ name: 'chromium' }],
});
