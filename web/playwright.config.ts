import { defineConfig, devices } from '@playwright/test';

// Ende-zu-Ende-Tests gegen den echten Go-Server (E2E_BASE_URL, Standard :8080).
// Der Server muss mit den Testdaten aus testdata/beispiel-kitas.csv laufen (siehe Makefile: make e2e).
export default defineConfig({
  testDir: './e2e',
  timeout: 90_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:8080',
    trace: 'off',
    launchOptions: process.env.PW_CHROMIUM ? { executablePath: process.env.PW_CHROMIUM } : {},
  },
  projects: [
    { name: 'iphone-se', use: { ...devices['iPhone SE'], browserName: 'chromium' } },
    { name: 'pixel-7', use: { ...devices['Pixel 7'] } },
  ],
});
