// Shared E2E helpers. Elements are located only by data-testid and data-* attributes (TST-04).
import { expect, type APIRequestContext, type Page } from "@playwright/test";

/** Reset the account, open the terminal and wait for the price stream (isolates every test). */
export async function freshApp(page: Page, request: APIRequestContext): Promise<void> {
  const res = await request.post("/api/reset");
  expect(res.ok()).toBe(true);
  await page.goto("/");
  await expect(page.getByTestId("connection-dot")).toHaveAttribute("data-status", "open");
}

/** Parse a displayed money value such as "$10,000.00", "-$5.00" or "+$1.20" into a number. */
export function money(text: string | null): number {
  const raw = (text ?? "").trim();
  const negative = raw.startsWith("-");
  const value = Number(raw.replace(/[^0-9.]/g, ""));
  if (raw === "" || Number.isNaN(value)) {
    throw new Error(`Not a money value: "${raw}"`);
  }
  return negative ? -value : value;
}

/** The cash balance shown in the header. */
export async function cashOf(page: Page): Promise<number> {
  return money(await page.getByTestId("header-cash").textContent());
}

async function tradeFromBar(
  page: Page,
  side: "buy" | "sell",
  ticker: string,
  qty: number,
): Promise<void> {
  await page.getByTestId("trade-ticker").fill(ticker);
  await page.getByTestId("trade-qty").fill(String(qty));
  await page.getByTestId(side === "buy" ? "trade-buy" : "trade-sell").click();
  await expect(page.getByTestId("trade-message")).toHaveAttribute("data-kind", "success");
}

/** Buy from the trade bar and wait for the fill confirmation. */
export function buyFromBar(page: Page, ticker: string, qty: number): Promise<void> {
  return tradeFromBar(page, "buy", ticker, qty);
}

/** Sell from the trade bar and wait for the fill confirmation. */
export function sellFromBar(page: Page, ticker: string, qty: number): Promise<void> {
  return tradeFromBar(page, "sell", ticker, qty);
}

/** Send one chat message with Enter. */
export async function sendChat(page: Page, text: string): Promise<void> {
  const input = page.getByTestId("chat-input");
  await input.fill(text);
  await input.press("Enter");
}
