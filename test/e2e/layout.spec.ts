// Real-browser layout checks for the Phase 3 UI review fixes (UX-02): the Heatmap/P&L and
// Positions/Trade pairs stack below lg, the chat toggle is a 24px target, the collapsed xl
// rail shows its heading, and the color tokens the P&L chart reads exist in the export.
// Elements are located only by data-testid (TST-04).
import { expect, type Locator, type Page, type TestInfo, test } from "@playwright/test";

import { freshApp } from "./helpers";

const TOLERANCE = 1;

async function box(locator: Locator) {
  await expect(locator).toBeVisible();
  const b = await locator.boundingBox();
  expect(b).not.toBeNull();
  return b!;
}

async function attachScreenshot(page: Page, testInfo: TestInfo, name: string) {
  await testInfo.attach(name, {
    body: await page.screenshot({ fullPage: true }),
    contentType: "image/png",
  });
}

test.describe("768x1024", () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test("the panel pairs stack into one full-width column", async ({ page, request }, testInfo) => {
    await freshApp(page, request);
    const heatmap = await box(page.getByTestId("panel-heatmap"));
    const pnl = await box(page.getByTestId("panel-pnl"));
    const positions = await box(page.getByTestId("panel-positions"));
    const trade = await box(page.getByTestId("panel-trade"));
    const chart = await box(page.getByTestId("panel-chart"));

    expect(pnl.y).toBeGreaterThanOrEqual(heatmap.y + heatmap.height - TOLERANCE);
    expect(trade.y).toBeGreaterThanOrEqual(positions.y + positions.height - TOLERANCE);
    expect(positions.width).toBeGreaterThanOrEqual(480);
    for (const panel of [heatmap, pnl, positions, trade]) {
      expect(panel.height).toBeGreaterThanOrEqual(180);
    }
    expect(chart.height).toBeGreaterThanOrEqual(250);

    await attachScreenshot(page, testInfo, "layout-768x1024");
  });
});

test.describe("1024x768", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("the panel pairs sit side by side", async ({ page, request }, testInfo) => {
    await freshApp(page, request);
    const pairs: [string, string][] = [
      ["panel-heatmap", "panel-pnl"],
      ["panel-positions", "panel-trade"],
    ];
    for (const [leftId, rightId] of pairs) {
      const left = await box(page.getByTestId(leftId));
      const right = await box(page.getByTestId(rightId));
      expect(Math.abs(right.y - left.y)).toBeLessThanOrEqual(TOLERANCE);
      expect(right.x).toBeGreaterThanOrEqual(left.x + left.width - TOLERANCE);
    }

    await attachScreenshot(page, testInfo, "layout-1024x768");
  });
});

test.describe("1440x900", () => {
  test("the chat toggle is at least 24px in both states", async ({ page, request }) => {
    await freshApp(page, request);
    const toggle = page.getByTestId("chat-toggle");
    const expanded = await box(toggle);
    expect(expanded.width).toBeGreaterThanOrEqual(23.5);
    expect(expanded.height).toBeGreaterThanOrEqual(23.5);

    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-expanded", "false");
    const collapsed = await box(toggle);
    expect(collapsed.width).toBeGreaterThanOrEqual(23.5);
    expect(collapsed.height).toBeGreaterThanOrEqual(23.5);
  });

  test("the collapsed rail shows the heading as vertical text", async ({ page, request }) => {
    await freshApp(page, request);
    await page.getByTestId("chat-toggle").click();
    await expect(page.getByTestId("chat-toggle")).toHaveAttribute("aria-expanded", "false");

    const title = await box(page.getByTestId("chat-title"));
    const rail = await box(page.getByTestId("panel-chat"));
    expect(title.height).toBeGreaterThan(title.width);
    expect(title.height).toBeGreaterThanOrEqual(40);
    expect(title.x).toBeGreaterThanOrEqual(rail.x - TOLERANCE);
    expect(title.y).toBeGreaterThanOrEqual(rail.y - TOLERANCE);
    expect(title.x + title.width).toBeLessThanOrEqual(rail.x + rail.width + TOLERANCE);
    expect(title.y + title.height).toBeLessThanOrEqual(rail.y + rail.height + TOLERANCE);
  });

  test("the export defines the up/down color tokens the P&L chart reads", async ({
    page,
    request,
  }) => {
    await freshApp(page, request);
    const tokens = await page.evaluate(() => {
      const style = getComputedStyle(document.documentElement);
      return [style.getPropertyValue("--color-up"), style.getPropertyValue("--color-down")].map(
        (v) => v.trim(),
      );
    });
    for (const token of tokens) expect(token).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
