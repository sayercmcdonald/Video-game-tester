import { defineConfig } from "@playwright/test";

// End-to-end tests run the production build against a separate database.
// Run `npm run build` first, then `npm run test:e2e`.
const E2E_DB = process.env.E2E_DATABASE_URL ?? "postgresql://mission:mission_dev_pw@localhost:5432/mission_e2e";
const PORT = 3100;

export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  timeout: 90_000,
  expect: { timeout: 15_000 },
  reporter: [["list"]],
  use: {
    baseURL: `http://localhost:${PORT}`,
    trace: "retain-on-failure",
    // Optional: point at a preinstalled Chromium instead of `npx playwright install`.
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_PATH ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_PATH } : {},
  },
  webServer: {
    command: `npx next start -p ${PORT}`,
    url: `http://localhost:${PORT}/api/health`,
    reuseExistingServer: false,
    timeout: 60_000,
    env: {
      APP_ENV: "test",
      APP_URL: `http://localhost:${PORT}`,
      DATABASE_URL: E2E_DB,
      STORAGE_DIR: "./storage/e2e-uploads",
      EMAIL_TRANSPORT: "log",
      STRIPE_SECRET_KEY: "",
      STRIPE_WEBHOOK_SECRET: "",
      DATA_ENCRYPTION_KEY: Buffer.alloc(32, 3).toString("base64"),
      CRON_SECRET: "e2e-cron-secret",
    },
  },
});
