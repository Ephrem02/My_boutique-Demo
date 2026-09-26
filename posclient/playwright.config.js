// Browser checks against an isolated stack: the API on :4199 using the TEST
// database (seeded by `npm run seed:e2e` in backend/), and Vite on :5199.
// Uses the locally installed Chrome, so no browser download is needed.
import { defineConfig } from '@playwright/test';

const API = 'http://localhost:4199';
const WEB = 'http://localhost:5199';

export default defineConfig({
  testDir: './e2e',
  outputDir: './e2e/artifacts/test-results',
  timeout: 60_000,
  workers: 1, // one shared, seeded test database
  reporter: [['list']],
  globalSetup: './e2e/global-setup.js',
  use: {
    baseURL: WEB,
    channel: 'chrome',
    headless: true,
    trace: 'off',
  },
  projects: [
    { name: 'mobile', use: { viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
    { name: 'tablet', use: { viewport: { width: 820, height: 1180 }, hasTouch: true } },
    { name: 'desktop', use: { viewport: { width: 1366, height: 820 } } },
  ],
  webServer: [
    {
      command: 'node server.js',
      cwd: '../backend',
      url: `${API}/health`,
      reuseExistingServer: false,
      env: { NODE_ENV: 'test', PORT: '4199', CORS_ORIGINS: WEB, LOGIN_RATE_LIMIT: '10000', API_RATE_LIMIT: '100000' },
    },
    {
      // Launched directly (not via npx) so Playwright can stop it cleanly on Windows
      command: 'node node_modules/vite/bin/vite.js --port 5199 --strictPort',
      url: WEB,
      reuseExistingServer: false,
      env: { VITE_API_URL: `${API}/api` },
    },
  ],
});
