import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  // Keep reports and traces in the node_modules volume, out of the bind-mounted
  // checkout (nothing may leak to the host).
  outputDir: '../node_modules/.e2e-results',
  reporter: [['list']],
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  use: {
    baseURL: `http://localhost:${process.env.WEB_PORT ?? '5173'}`,
    trace: 'retain-on-failure',
  },
  // The virtual authenticator is a Chromium DevTools Protocol feature.
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
