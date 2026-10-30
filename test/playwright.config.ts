// Playwright config for the FinAlly E2E suite (PLAN section 12, TST-03).
// Run it through test/docker-compose.test.yml, which starts an isolated app in LLM mock mode.
import { defineConfig, devices } from "@playwright/test";

// No default on purpose: every test POSTs /api/reset, so pointing this suite at an app that
// holds real data would wipe that portfolio (research Pitfall 5, assumption A-22).
const baseURL = process.env.BASE_URL;
if (!baseURL) {
  throw new Error(
    "BASE_URL is not set. It must point at the throwaway E2E app started by " +
      "test/docker-compose.test.yml (http://finally-app:8000 inside that compose project), because " +
      "every test resets the account it runs against.",
  );
}

const viewport = { width: 1440, height: 900 };

export default defineConfig({
  testDir: "./e2e",
  // One backend is shared by every test and each test resets it, so tests run one at a time.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: [["list"], ["html", { open: "never" }]],
  expect: { timeout: 10_000 },
  use: {
    baseURL,
    viewport,
    trace: "retain-on-failure",
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport },
    },
  ],
});
