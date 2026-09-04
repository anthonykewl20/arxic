import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './tests',
  workers: 1,
  outputDir: './artifacts/test-results',
  use: { browserName: "chromium", headless: true, trace: "retain-on-failure", serviceWorkers: 'block' },
});
