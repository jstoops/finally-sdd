// Scenario 7: the Reset button restores the seeded account and clears the chat.
import { expect, test } from "@playwright/test";

import { buyFromBar, cashOf, freshApp, sendChat } from "./helpers";

test.beforeEach(async ({ page, request }) => {
  await freshApp(page, request);
});

test("reset after trading restores $10,000, the default watchlist and an empty chat", async ({
  page,
}) => {
  await buyFromBar(page, "AAPL", 1);
  await expect(page.getByTestId("position-row-AAPL")).toBeVisible();
  await expect.poll(() => cashOf(page)).toBeLessThan(10_000);

  await page.getByTestId("add-ticker-input").fill("PYPL");
  await page.getByTestId("add-ticker-submit").click();
  await expect(page.getByTestId("watchlist-row-PYPL")).toBeVisible();

  await sendChat(page, "hello");
  await expect(
    page.locator('[data-testid="chat-message"][data-role="assistant"]'),
  ).toBeVisible();

  page.once("dialog", (dialog) => dialog.accept());
  await page.getByTestId("reset-button").click();

  await expect(page.getByTestId("header-cash")).toHaveText("$10,000.00");
  await expect(page.locator('[data-testid^="watchlist-row-"]')).toHaveCount(10);
  await expect(page.getByTestId("watchlist-row-PYPL")).toBeHidden();
  await expect(page.getByTestId("positions-empty")).toBeVisible();
  await expect(page.getByTestId("chat-message")).toHaveCount(0);
  await expect(page.getByTestId("chat-prompt").first()).toBeVisible();
});
