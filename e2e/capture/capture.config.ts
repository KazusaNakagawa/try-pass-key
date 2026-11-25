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
    // Wide enough for the two-column layout (inputs left, responses right).
    viewport: { width: 1120, height: 1000 },
    // Dark, to match the real-device captures taken on a dark desktop.
    colorScheme: 'dark',
    video: { mode: 'on', size: { width: 1120, height: 1000 } },
    launchOptions: { slowMo: 250 },
  },
  projects: [{ name: 'chromium' }],
});
