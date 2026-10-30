// Scenarios 3 and 4: buy and sell from the trade bar. Assertions are relational, never exact
// live prices (research Pitfall 6).
import { expect, test } from "@playwright/test";

import { buyFromBar, cashOf, freshApp, sellFromBar } from "./helpers";

test.beforeEach(async ({ page, request }) => {
  await freshApp(page, request);
});

test("buying 1 AAPL opens a position, spends cash and logs one trade", async ({ page }) => {
  await expect(page.getByTestId("positions-empty")).toBeVisible();

  await buyFromBar(page, "AAPL", 1);

  await expect(page.getByTestId("position-row-AAPL")).toBeVisible();
  await expect.poll(() => cashOf(page)).toBeLessThan(10_000);
  await expect(page.getByTestId("trade-history-row")).toHaveCount(1);
});

test("a rejected sell shows the 400 error inline and changes nothing", async ({ page }) => {
  await page.getByTestId("trade-ticker").fill("AAPL");
  await page.getByTestId("trade-qty").fill("1");
  await page.getByTestId("trade-sell").click();

  const message = page.getByTestId("trade-message");
  await expect(message).toHaveAttribute("data-kind", "error");
  await expect(message).toContainText("Insufficient shares");
  await expect(page.getByTestId("header-cash")).toHaveText("$10,000.00");
  await expect(page.getByTestId("positions-empty")).toBeVisible();
  await expect(page.getByTestId("trade-history-row")).toHaveCount(0);
});

test("selling the whole position closes it and returns cash", async ({ page }) => {
  await buyFromBar(page, "AAPL", 2);
  await expect(page.getByTestId("position-row-AAPL")).toBeVisible();
  await expect.poll(() => cashOf(page)).toBeLessThan(10_000);
  const cashAfterBuy = await cashOf(page);

  await sellFromBar(page, "AAPL", 2);

  await expect(page.getByTestId("position-row-AAPL")).toBeHidden();
  await expect(page.getByTestId("positions-empty")).toBeVisible();
  await expect.poll(() => cashOf(page)).toBeGreaterThan(cashAfterBuy);
  await expect(page.getByTestId("trade-history-row")).toHaveCount(2);
});
