// Scenario 5: portfolio visualization (heatmap colors follow P&L, P&L chart has points).
import { expect, test } from "@playwright/test";

import { buyFromBar, freshApp } from "./helpers";

test.beforeEach(async ({ page, request }) => {
  await freshApp(page, request);
});

test("heatmap tile sign matches the position P&L sign and the P&L chart has data", async ({
  page,
}) => {
  await expect(page.getByTestId("heatmap-empty")).toBeVisible();

  await buyFromBar(page, "AAPL", 1);

  await expect(page.getByTestId("heatmap-tile-AAPL")).toBeVisible();
  await expect(page.getByTestId("position-pnlpct-AAPL")).toBeVisible();

  // One evaluate reads both signs in the same frame; two separate reads can straddle a tick.
  await expect
    .poll(() =>
      page.evaluate(() => {
        const tile = document.querySelector('[data-testid="heatmap-tile-AAPL"]');
        const pct = document.querySelector('[data-testid="position-pnlpct-AAPL"]');
        const tileSign = tile?.getAttribute("data-sign");
        return tileSign != null && tileSign === pct?.getAttribute("data-sign");
      }),
    )
    .toBe(true);

  // The reset snapshot plus the snapshot recorded after the trade (assumption A-24).
  await expect
    .poll(async () =>
      Number(await page.getByTestId("pnl-chart").getAttribute("data-point-count")),
    )
    .toBeGreaterThanOrEqual(2);
});
