import { defineConfig } from '@playwright/test';
import { existsSync } from 'node:fs';

const localChrome = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH ||
  (process.platform === 'win32' && existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe' : undefined);
const liveUrl = process.env.PLAYWRIGHT_BASE_URL;

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: 'list',
  use: {
    baseURL: liveUrl || 'http://127.0.0.1:4173/CanadaPayCalculator/',
    browserName: 'chromium',
    launchOptions: localChrome ? { executablePath: localChrome } : {},
    trace: 'retain-on-failure',
    serviceWorkers: 'allow',
  },
  webServer: liveUrl ? undefined : {
    command: 'node scripts/serve.mjs',
    url: 'http://127.0.0.1:4173/CanadaPayCalculator/',
    reuseExistingServer: !process.env.CI,
    timeout: 15_000,
  },
});
