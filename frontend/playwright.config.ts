import { defineConfig, devices } from '@playwright/test';

// E2E runs against the REAL desktop stack, not a dev server:
//  - the production static export (out/), which is exactly what the Tauri
//    webview loads, served on localhost:3000 (CORS-allowed origin), and
//  - the real FastAPI backend + real SQLite on 127.0.0.1:43888, on an
//    isolated PASADA_DATA_DIR so a test run never touches real office data.
// Boot/teardown of both lives in e2e/support/servers.ts.
//
// Chromium is the primary runner. The 'webkit' project exists so the flows
// are also proven in a WebKitGTK-family engine, which is what the Linux
// (and macOS) Tauri webview uses; run it with: npx playwright test --project=webkit
export default defineConfig({
  testDir: './e2e',
  timeout: 60000,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/support/global-setup',
  globalTeardown: './e2e/support/global-teardown',
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'webkit',
      use: { ...devices['Desktop Safari'] },
    },
  ],
});
