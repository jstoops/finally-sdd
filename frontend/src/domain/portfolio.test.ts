import { describe, expect, it } from "vitest";

import type { Position } from "@/api/types";
import {
  formatSignedMoney,
  livePortfolio,
  moneySign,
  pctSign,
  pnlColor,
  STARTING_CASH,
  toCents,
} from "@/domain/portfolio";

function position(
  ticker: string,
  quantity: number,
  avgCost: number,
  currentPrice: number,
): Position {
  return {
    ticker,
    quantity,
    avg_cost: avgCost,
    current_price: currentPrice,
    market_value: 0,
    unrealized_pnl: 0,
    unrealized_pnl_percent: 0,
    weight: 0,
  };
}

const ticksOf = (prices: Record<string, number>) =>
  Object.fromEntries(Object.entries(prices).map(([t, price]) => [t, { price }]));

describe("toCents", () => {
  it.each([
    [0.125, 0.13],
    [2.675, 2.68],
    [-0.125, -0.13],
    [1905.2, 1905.2],
    [0.1 + 0.2, 0.3],
    [0.00499999, 0],
  ])("toCents(%s) == %s", (input, expected) => {
    expect(toCents(input)).toBe(expected);
  });

  it("never returns negative zero", () => {
    expect(Object.is(toCents(-0.004), 0)).toBe(true);
  });
});

// The same literals as 02-02's backend test_valuation.py: the client must equal the
// server's exact Decimal half-up to the cent. The tick differs from current_price, so the
// row is valued at the streamed price, not the served one.
describe("livePortfolio server parity", () => {
  function row(quantity: number, avgCost: number, tick: number) {
    const live = livePortfolio(0, [position("X", quantity, avgCost, tick - 1)], ticksOf({ X: tick }));
    return live.rows[0];
  }

  it.each([
    [0.0005, 250.0, 250.0, 0.13],
    [0.0125, 190.5, 190.5, 2.38],
    [1.5, 1.67, 1.67, 2.51],
  ])("market_value of %s @ avg %s, tick %s is %s", (qty, avg, tick, expected) => {
    expect(row(qty, avg, tick).market_value).toBe(expected);
  });

  it.each([
    [0.5, 10.0, 10.01, 0.01],
    [49.9999, 99.9999, 100.0, 0],
    [0.5, 10.01, 10.0, -0.01],
    [0.25, 190.5, 190.52, 0.01],
  ])("unrealized_pnl of %s @ avg %s, tick %s is %s", (qty, avg, tick, expected) => {
    expect(row(qty, avg, tick).unrealized_pnl).toBe(expected);
  });
});

describe("livePortfolio", () => {
  it("values an empty account at its cash", () => {
    expect(livePortfolio(10000, [], {})).toEqual({
      cash: 10000,
      positionsValue: 0,
      total: 10000,
      pnlSinceStart: 0,
      rows: [],
    });
  });

  it("uses the server current_price when there is no tick, and the tick when there is", () => {
    const positions = [position("AAPL", 10, 190.5, 190.52)];
    const idle = livePortfolio(8094.8, positions, {});
    expect(idle.total).toBe(10000);
    expect(idle.pnlSinceStart).toBe(0);
    expect(idle.rows[0]).toMatchObject({
      current_price: 190.52,
      market_value: 1905.2,
      unrealized_pnl: 0.2,
      weight: 1,
    });

    const moved = livePortfolio(8094.8, positions, ticksOf({ AAPL: 191.52 }));
    expect(moved.rows[0].current_price).toBe(191.52);
    expect(moved.rows[0].market_value).toBe(1915.2);
    expect(moved.positionsValue).toBe(1915.2);
    expect(moved.total).toBe(10010);
    expect(moved.pnlSinceStart).toBe(10);
  });

  it("values a held ticker with no tick at the server price while others stream", () => {
    const live = livePortfolio(
      0,
      [position("AAPL", 1, 100, 100), position("TSLA", 1, 200, 250)],
      ticksOf({ AAPL: 110 }),
    );
    expect(live.rows.map((r) => r.current_price)).toEqual([110, 250]);
    expect(live.positionsValue).toBe(360);
  });

  it("gives weights that sum to 1", () => {
    const live = livePortfolio(
      0,
      [position("AAPL", 3, 100, 100), position("MSFT", 1, 100, 100)],
      {},
    );
    expect(live.rows.map((r) => r.weight)).toEqual([0.75, 0.25]);
    expect(live.rows.reduce((sum, r) => sum + r.weight, 0)).toBeCloseTo(1, 12);
  });

  it("gives P&L % in percent units, and 0 when avg_cost is 0", () => {
    const live = livePortfolio(
      0,
      [position("AAPL", 1, 100, 100), position("FREE", 1, 0, 5)],
      ticksOf({ AAPL: 101 }),
    );
    expect(live.rows[0].unrealized_pnl_percent).toBeCloseTo(1, 10);
    expect(live.rows[1].unrealized_pnl_percent).toBe(0);
  });

  it("measures P&L since start from STARTING_CASH", () => {
    expect(STARTING_CASH).toBe(10000);
    expect(livePortfolio(9995, [], {}).pnlSinceStart).toBe(-5);
  });
});

describe("signs and signed money", () => {
  it("formats signed money from the cent-rounded value", () => {
    expect(formatSignedMoney(12.345)).toBe("+$12.35");
    expect(formatSignedMoney(-5)).toBe("-$5.00");
    expect(formatSignedMoney(-0.004)).toBe("+$0.00");
    expect(formatSignedMoney(1234.5)).toBe("+$1,234.50");
  });

  it("takes the money sign from the cent-rounded value", () => {
    expect(moneySign(-0.004)).toBe("flat");
    expect(moneySign(0.005)).toBe("up");
    expect(moneySign(-10)).toBe("down");
  });

  it("takes the percent sign from the 2 dp value", () => {
    expect(pctSign(0.004)).toBe("flat");
    expect(pctSign(-0.006)).toBe("down");
    expect(pctSign(1.5)).toBe("up");
  });
});

describe("pnlColor", () => {
  it("is the neutral border color at 0%", () => {
    expect(pnlColor(0)).toBe("rgb(48, 54, 61)");
  });

  it("reaches the up color at +5% and clamps beyond it", () => {
    expect(pnlColor(5)).toBe("rgb(34, 197, 94)");
    expect(pnlColor(12)).toBe("rgb(34, 197, 94)");
  });

  it("reaches the down color at -5% and clamps beyond it", () => {
    expect(pnlColor(-5)).toBe("rgb(239, 68, 68)");
    expect(pnlColor(-40)).toBe("rgb(239, 68, 68)");
  });

  it("mixes each channel halfway at +2.5% and -2.5%, rounded", () => {
    expect(pnlColor(2.5)).toBe("rgb(41, 126, 78)");
    expect(pnlColor(-2.5)).toBe("rgb(144, 61, 65)");
  });

  it("treats a non-finite percent as neutral", () => {
    expect(pnlColor(Number.NaN)).toBe("rgb(48, 54, 61)");
  });
});
