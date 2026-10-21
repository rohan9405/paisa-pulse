import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "tests/e2e",
  timeout: 60_000,
  use: { baseURL: "http://localhost:3200", timezoneId: "Asia/Kolkata", locale: "en-IN" },
  projects: [
    { name: "mobile", use: { ...devices["Pixel 7"] } },
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1366, height: 860 } } },
  ],
  webServer: { command: "NEXT_DIST_DIR=.next-e2e npx next build && NEXT_DIST_DIR=.next-e2e npx next start -p 3200", url: "http://localhost:3200", reuseExistingServer: false, timeout: 240_000 },
});
