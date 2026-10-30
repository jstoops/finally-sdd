// Scenario 1 (fresh start) and the full-terminal layout at 1440x900 (UX-02).
import { expect, test } from "@playwright/test";

const PANELS = [
  "panel-watchlist",
  "panel-chart",
  "panel-heatmap",
  "panel-pnl",
  "panel-positions",
  "panel-trade",
  "panel-chat",
];

test.beforeEach(async ({ request, page }) => {
  await request.post("/api/reset");
  await page.goto("/");
});

test("fresh start shows the default watchlist, $10,000 and streaming prices", async ({ page }) => {
  await expect(page.locator('[data-testid^="watchlist-row-"]')).toHaveCount(10);
  await expect(page.getByTestId("header-cash")).toHaveText("$10,000.00");
  await expect(page.getByTestId("connection-dot")).toHaveAttribute("data-status", "open");

  const price = page.getByTestId("price-AAPL");
  await expect(price).not.toHaveText("—");
  const first = await price.textContent();
  await expect
    .poll(async () => price.textContent(), { timeout: 15_000 })
    .not.toBe(first);
});

test("every panel is visible at once at 1440x900", async ({ page }) => {
  for (const id of PANELS) {
    await expect(page.getByTestId(id)).toBeInViewport();
  }
  const fits = await page.evaluate(
    () => document.documentElement.scrollHeight <= window.innerHeight,
  );
  expect(fits).toBe(true);

  const toggle = page.getByTestId("chat-toggle");
  await expect(page.getByTestId("chat-input")).toBeVisible();
  await toggle.click();
  await expect(page.getByTestId("chat-input")).toBeHidden();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await toggle.click();
  await expect(page.getByTestId("chat-input")).toBeVisible();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
});
