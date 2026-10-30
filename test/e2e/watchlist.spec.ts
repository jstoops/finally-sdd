// Scenario 2: add and remove a ticker from the watchlist.
import { expect, test } from "@playwright/test";

import { freshApp } from "./helpers";

test.beforeEach(async ({ page, request }) => {
  await freshApp(page, request);
});

test("adds PYPL, prices it, then removes it", async ({ page }) => {
  await page.getByTestId("add-ticker-input").fill("PYPL");
  await page.getByTestId("add-ticker-submit").click();

  await expect(page.getByTestId("watchlist-row-PYPL")).toBeVisible();
  await expect(page.getByTestId("price-PYPL")).not.toHaveText("—");
  await expect(page.locator('[data-testid^="watchlist-row-"]')).toHaveCount(11);

  await page.getByTestId("remove-PYPL").click();
  await expect(page.getByTestId("watchlist-row-PYPL")).toBeHidden();
  await expect(page.locator('[data-testid^="watchlist-row-"]')).toHaveCount(10);
});
