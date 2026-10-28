import { act, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Portfolio, Trade, TradeResponse } from "@/api/types";
import { MESSAGE_MS, TradeBar } from "@/components/TradeBar";
import { usePortfolio } from "@/store/portfolio";
import { callsTo, jsonResponse, stubApi } from "@/test/stubFetch";

const QTY_ERROR = "Enter a quantity greater than 0.";
const EMPTY_TICKER = "Enter a ticker symbol.";
const FORMAT = "Use 1-10 letters, digits or '.', starting with a letter.";

const PORTFOLIO: Portfolio = {
  cash_balance: 8094.8,
  positions_value: 1905.2,
  total_value: 10000,
  unrealized_pnl: 0,
  positions: [],
};

function tradeOf(overrides: Partial<Trade> = {}): Trade {
  return {
    id: "t-1",
    ticker: "AAPL",
    side: "buy",
    quantity: 10,
    price: 190.52,
    executed_at: "2026-10-09T14:03:22Z",
    ...overrides,
  };
}

function responseOf(trade: Trade): TradeResponse {
  return { trade, portfolio: PORTFOLIO };
}

const tickerInput = () => screen.getByTestId("trade-ticker") as HTMLInputElement;
const qtyInput = () => screen.getByTestId("trade-qty") as HTMLInputElement;
const buy = () => screen.getByTestId("trade-buy");
const sell = () => screen.getByTestId("trade-sell");
const message = () => screen.queryByTestId("trade-message");

function renderBar() {
  const user = userEvent.setup();
  const view = render(<TradeBar />);
  return { user, ...view };
}

/** Fill both inputs with fireEvent (works under fake timers). */
function typeOrder(ticker: string, qty: string) {
  fireEvent.change(tickerInput(), { target: { value: ticker } });
  fireEvent.change(qtyInput(), { target: { value: qty } });
}

/** Click a button and let the store's awaited trade() settle inside act. */
async function clickAndSettle(button: HTMLElement) {
  await act(async () => {
    fireEvent.click(button);
  });
}

beforeEach(() => {
  usePortfolio.setState({ cash: null, positions: [], loaded: false, loadError: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("TradeBar client checks", () => {
  it("rejects an empty ticker without sending a request", async () => {
    const fetchMock = stubApi();
    const { user } = renderBar();
    await user.type(qtyInput(), "10");
    await user.click(buy());
    expect(message()).toHaveTextContent(EMPTY_TICKER);
    expect(message()).toHaveAttribute("data-kind", "error");
    expect(callsTo(fetchMock, "/api/portfolio/trade", "POST")).toHaveLength(0);
  });

  it("rejects a malformed ticker with the format message", async () => {
    const fetchMock = stubApi();
    const { user } = renderBar();
    await user.type(tickerInput(), "1ABC");
    await user.type(qtyInput(), "10");
    await user.click(buy());
    expect(message()).toHaveTextContent(FORMAT);
    expect(callsTo(fetchMock, "/api/portfolio/trade", "POST")).toHaveLength(0);
  });

  it("sanitizes the ticker as typed", async () => {
    stubApi();
    const { user } = renderBar();
    await user.type(tickerInput(), " aapl ");
    expect(tickerInput().value).toBe("AAPL");
  });

  it("rejects non-ASCII ticker input on the client", async () => {
    const fetchMock = stubApi();
    renderBar();
    typeOrder("ÄAPL", "1");
    await clickAndSettle(buy());
    expect(message()).toHaveTextContent(FORMAT);
    expect(callsTo(fetchMock, "/api/portfolio/trade", "POST")).toHaveLength(0);
  });

  it.each(["", "0", "-1", "abc", "1,5", "1e3", "1."])(
    "rejects quantity %j without sending a request",
    async (qty) => {
      const fetchMock = stubApi();
      renderBar();
      typeOrder("AAPL", qty);
      await clickAndSettle(buy());
      expect(message()).toHaveTextContent(QTY_ERROR);
      expect(message()).toHaveAttribute("data-kind", "error");
      expect(callsTo(fetchMock, "/api/portfolio/trade", "POST")).toHaveLength(0);
    },
  );

  it.each([".5", "0.5"])("sends quantity %j as 0.5", async (qty) => {
    const fetchMock = stubApi({
      "POST /api/portfolio/trade": responseOf(tradeOf({ quantity: 0.5 })),
    });
    renderBar();
    typeOrder("AAPL", qty);
    await clickAndSettle(buy());
    const [call] = callsTo(fetchMock, "/api/portfolio/trade", "POST");
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      ticker: "AAPL",
      quantity: 0.5,
      side: "buy",
    });
  });
});

describe("TradeBar server errors", () => {
  it("shows a 400 error text inline as an alert", async () => {
    const text = "Insufficient cash (need $12,450.00, have $8,095.00).";
    stubApi({ "POST /api/portfolio/trade": jsonResponse({ error: text }, 400) });
    renderBar();
    typeOrder("TSLA", "50");
    await clickAndSettle(buy());
    expect(message()).toHaveTextContent(text);
    expect(message()).toHaveAttribute("data-kind", "error");
    expect(message()).toHaveAttribute("role", "alert");
    expect(message()).toHaveClass("text-down");
  });

  it("shows 'Invalid request' for a 422", async () => {
    stubApi({
      "POST /api/portfolio/trade": jsonResponse({ detail: [{ msg: "bad" }] }, 422),
    });
    renderBar();
    typeOrder("AAPL", "1");
    await clickAndSettle(sell());
    expect(message()).toHaveTextContent("Invalid request");
  });

  it.each(["ticker", "qty"] as const)("typing in the %s input clears the message", async (which) => {
    stubApi({ "POST /api/portfolio/trade": jsonResponse({ error: "Nope." }, 400) });
    const { user } = renderBar();
    typeOrder("AAPL", "1");
    await clickAndSettle(buy());
    expect(message()).toHaveTextContent("Nope.");
    await user.type(which === "ticker" ? tickerInput() : qtyInput(), "1");
    expect(message()).toBeNull();
  });
});

describe("TradeBar pending state", () => {
  it("disables both buttons while a trade is in flight and ignores a second click", async () => {
    let release: (body: TradeResponse) => void = () => {};
    const fetchMock = stubApi({
      "POST /api/portfolio/trade": () =>
        new Promise<TradeResponse>((resolve) => {
          release = resolve;
        }),
    });
    renderBar();
    typeOrder("AAPL", "10");
    await clickAndSettle(buy());
    expect(buy()).toBeDisabled();
    expect(sell()).toBeDisabled();

    await clickAndSettle(buy());
    await clickAndSettle(sell());
    expect(callsTo(fetchMock, "/api/portfolio/trade", "POST")).toHaveLength(1);

    await act(async () => {
      release(responseOf(tradeOf()));
    });
    expect(buy()).toBeEnabled();
    expect(sell()).toBeEnabled();
  });
});

describe("TradeBar fill confirmation", () => {
  it("shows the recorded buy fill, clears the quantity and keeps the ticker", async () => {
    stubApi({ "POST /api/portfolio/trade": responseOf(tradeOf()) });
    renderBar();
    typeOrder("AAPL", "10");
    await clickAndSettle(buy());
    expect(message()).toHaveTextContent("Bought 10 AAPL @ $190.52");
    expect(message()).toHaveAttribute("data-kind", "success");
    expect(qtyInput().value).toBe("");
    expect(tickerInput().value).toBe("AAPL");
  });

  it("formats a sell with grouped 2 dp price", async () => {
    stubApi({
      "POST /api/portfolio/trade": responseOf(
        tradeOf({ side: "sell", quantity: 2.5, price: 1234.5 }),
      ),
    });
    renderBar();
    typeOrder("AAPL", "2.5");
    await clickAndSettle(sell());
    expect(message()).toHaveTextContent("Sold 2.5 AAPL @ $1,234.50");
  });

  it("formats a floating-point quantity with at most 4 dp", async () => {
    stubApi({
      "POST /api/portfolio/trade": responseOf(tradeOf({ quantity: 0.1 + 0.2 })),
    });
    renderBar();
    typeOrder("AAPL", "0.3");
    await clickAndSettle(buy());
    expect(message()).toHaveTextContent("Bought 0.3 AAPL @ $190.52");
  });

  it("shows the recorded (clamped) fill quantity, not the typed one", async () => {
    stubApi({ "POST /api/portfolio/trade": responseOf(tradeOf({ quantity: 9.9999 })) });
    renderBar();
    typeOrder("AAPL", "10");
    await clickAndSettle(buy());
    expect(message()).toHaveTextContent("Bought 9.9999 AAPL @ $190.52");
  });

  it("after a fill, Buy with the emptied quantity shows the quantity error and sends nothing", async () => {
    const fetchMock = stubApi({ "POST /api/portfolio/trade": responseOf(tradeOf()) });
    renderBar();
    typeOrder("AAPL", "10");
    await clickAndSettle(buy());
    await clickAndSettle(buy());
    expect(message()).toHaveTextContent(QTY_ERROR);
    expect(callsTo(fetchMock, "/api/portfolio/trade", "POST")).toHaveLength(1);
  });

  it("never opens a confirmation dialog", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    stubApi({ "POST /api/portfolio/trade": responseOf(tradeOf()) });
    renderBar();
    typeOrder("AAPL", "10");
    await clickAndSettle(buy());
    typeOrder("AAPL", "1");
    await clickAndSettle(sell());
    expect(confirmSpy).not.toHaveBeenCalled();
  });
});

describe("TradeBar fill message timer", () => {
  const fill = (trade: Trade) =>
    vi.fn(async () => ({ trade }) as { trade: Trade; error?: undefined });

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  });

  it("clears the success message after exactly MESSAGE_MS", async () => {
    expect(MESSAGE_MS).toBe(3000);
    usePortfolio.setState({ trade: fill(tradeOf()) });
    render(<TradeBar />);
    typeOrder("AAPL", "10");
    await clickAndSettle(buy());
    expect(message()).toHaveTextContent("Bought 10 AAPL @ $190.52");

    act(() => vi.advanceTimersByTime(2999));
    expect(message()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(message()).toBeNull();
  });

  it("a second fill within the window replaces the text and restarts the timer", async () => {
    const trade = vi
      .fn()
      .mockResolvedValueOnce({ trade: tradeOf() })
      .mockResolvedValueOnce({ trade: tradeOf({ id: "t-2", quantity: 5 }) });
    usePortfolio.setState({ trade });
    render(<TradeBar />);
    typeOrder("AAPL", "10");
    await clickAndSettle(buy());

    act(() => vi.advanceTimersByTime(2000));
    typeOrder("AAPL", "5");
    await clickAndSettle(buy());
    expect(message()).toHaveTextContent("Bought 5 AAPL @ $190.52");

    // The first fill's timer would have fired here; the restarted one has not.
    act(() => vi.advanceTimersByTime(1000));
    expect(message()).toHaveTextContent("Bought 5 AAPL @ $190.52");
    act(() => vi.advanceTimersByTime(1999));
    expect(message()).not.toBeNull();
    act(() => vi.advanceTimersByTime(1));
    expect(message()).toBeNull();
  });

  it("an error does not get cleared by the timer", async () => {
    usePortfolio.setState({ trade: vi.fn(async () => ({ error: "Nope." })) });
    render(<TradeBar />);
    typeOrder("AAPL", "10");
    await clickAndSettle(buy());
    act(() => vi.advanceTimersByTime(MESSAGE_MS * 2));
    expect(message()).toHaveTextContent("Nope.");
  });

  it("unmounting before the timer fires clears it without warnings", async () => {
    const errorSpy = vi.spyOn(console, "error");
    usePortfolio.setState({ trade: fill(tradeOf()) });
    const { unmount } = render(<TradeBar />);
    typeOrder("AAPL", "10");
    await clickAndSettle(buy());
    expect(vi.getTimerCount()).toBe(1);

    unmount();
    expect(vi.getTimerCount()).toBe(0);
    act(() => vi.advanceTimersByTime(MESSAGE_MS));
    expect(errorSpy).not.toHaveBeenCalled();
  });
});
