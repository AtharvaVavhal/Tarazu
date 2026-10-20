import { defineConfig, devices } from '@playwright/test';

// Skeleton only (M0). E2E journeys of 07 §5 arrive with the features they cover.
export default defineConfig({
  testDir: './tests/e2e',
  retries: 0,
  use: { baseURL: 'http://localhost:5173' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: { command: 'npm run dev', url: 'http://localhost:5173', reuseExistingServer: true },
});
