import { defineConfig, devices } from '@playwright/test';

const base = process.env.SITE_URL ?? 'http://127.0.0.1:8080/website/';
export default defineConfig({
  testDir: 'tests/browser',
  timeout: 120_000,
  use: { baseURL: base },
  webServer: process.env.SITE_URL ? undefined : { command: 'python3 -m http.server 8080', url: base, reuseExistingServer: true },
  projects: [
    { name: 'desktop', use: { ...devices['Desktop Chrome'] } },
    { name: 'mobile', use: { ...devices['Pixel 7'] } },
  ],
});
