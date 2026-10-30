// Scenario 6: the AI chat in LLM mock mode (PLAN section 9 mock table). "buy" always buys
// 1 AAPL, whatever else the message says (research Pitfall 12).
import { expect, test, type Page } from "@playwright/test";

import { freshApp, sendChat } from "./helpers";

const assistant = (page: Page) =>
  page.locator('[data-testid="chat-message"][data-role="assistant"]');
const action = (page: Page, kind: string, status: string) =>
  page.locator(`[data-testid="chat-action"][data-kind="${kind}"][data-status="${status}"]`);

test.beforeEach(async ({ page, request }) => {
  await freshApp(page, request);
});

test("a mocked buy replies, shows an executed trade chip and opens the position", async ({
  page,
}) => {
  await expect(page.getByTestId("chat-prompt").first()).toBeVisible();

  await sendChat(page, "buy");

  await expect(assistant(page)).toContainText("Buying 1 share of AAPL.");
  await expect(action(page, "trade", "executed")).toBeVisible();
  await expect(page.getByTestId("position-row-AAPL")).toBeVisible();
  // The mock answers in milliseconds; the visible state is covered by unit tests (A-23).
  await expect(page.getByTestId("chat-loading")).toBeHidden();
});

test("a mocked sell with nothing held shows a failed chip and the failure note", async ({
  page,
}) => {
  await sendChat(page, "sell");

  await expect(assistant(page)).toContainText("Selling 1 share of AAPL.");
  await expect(action(page, "trade", "failed")).toBeVisible();
  await expect(assistant(page)).toContainText(
    "Couldn't sell 1 AAPL: insufficient shares (need 1, have 0).",
  );
  await expect(page.getByTestId("positions-empty")).toBeVisible();
});

test("a mocked add puts the ticker on the watchlist", async ({ page }) => {
  await sendChat(page, "add PYPL");

  await expect(assistant(page)).toContainText("Adding PYPL to your watchlist.");
  await expect(action(page, "watchlist", "executed")).toBeVisible();
  await expect(page.getByTestId("watchlist-row-PYPL")).toBeVisible();
});

test("the conversation and its chips survive a page reload", async ({ page }) => {
  await sendChat(page, "buy");
  await expect(action(page, "trade", "executed")).toBeVisible();

  await page.reload();

  await expect(page.locator('[data-testid="chat-message"][data-role="user"]')).toContainText(
    "buy",
  );
  await expect(assistant(page)).toContainText("Buying 1 share of AAPL.");
  await expect(action(page, "trade", "executed")).toBeVisible();
  await expect(page.getByTestId("chat-prompt")).toHaveCount(0);
});
