import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WatchlistEntry } from "@/api/types";
import { Watchlist } from "@/components/Watchlist";
import { usePrices } from "@/store/prices";
import { useWatchlist } from "@/store/watchlist";

const FORMAT = "Use 1-10 letters, digits or '.', starting with a letter.";
const CAP = "Watchlist is full (50 tickers). Remove one before adding another.";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function entry(ticker: string, price: number | null = 100, open: number | null = 100): WatchlistEntry {
  return { ticker, price, open_price: open, added_at: "2026-10-09T14:00:00Z" };
}

const ENTRIES: WatchlistEntry[] = [entry("AAPL"), entry("MSFT"), entry("NVDA")];

/** Stub fetch with one handler; returns the mock so tests can inspect calls. */
function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => handler(url, init));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function renderWatchlist(entries: WatchlistEntry[] = ENTRIES) {
  act(() => {
    useWatchlist.getState().setEntries(entries);
    useWatchlist.setState({ loaded: true, loadError: null });
  });
  const user = userEvent.setup();
  render(<Watchlist />);
  return user;
}

function rowTickers(): (string | null)[] {
  return within(screen.getByTestId("watchlist"))
    .getAllByRole("listitem")
    .map((li) => li.getAttribute("data-testid"));
}

const input = () => screen.getByTestId("add-ticker-input") as HTMLInputElement;
const submit = () => screen.getByTestId("add-ticker-submit");

beforeEach(() => {
  usePrices.setState({ ticks: {}, lastTs: {}, spark: {}, status: "connecting" });
  useWatchlist.setState({ entries: [], loaded: false, loadError: null, selected: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("AddTickerForm", () => {
  it("renders a compact input with the Add ticker hint and a + submit button", () => {
    stubFetch(() => jsonResponse({}));
    renderWatchlist();
    expect(input()).toHaveAttribute("placeholder", "Add ticker");
    expect(input()).toHaveAttribute("aria-label", "Add ticker");
    expect(input()).toHaveAttribute("maxLength", "10");
    expect(submit()).toHaveTextContent("+");
    expect(submit()).toHaveAttribute("aria-label", "Add ticker");
    expect(submit()).toHaveClass("bg-submit");
    expect(screen.queryByTestId("add-ticker-error")).toBeNull();
  });

  it("trims and uppercases as the user types", async () => {
    stubFetch(() => jsonResponse({}));
    const user = renderWatchlist();
    await user.type(input(), " pypl");
    expect(input()).toHaveValue("PYPL");
  });

  it("blocks a malformed symbol on Enter with an inline alert and no request", async () => {
    const fetchMock = stubFetch(() => jsonResponse({}));
    const user = renderWatchlist();
    await user.type(input(), "1abc{Enter}");
    const error = screen.getByTestId("add-ticker-error");
    expect(error).toHaveTextContent(FORMAT);
    expect(error).toHaveAttribute("role", "alert");
    expect(error).toHaveClass("text-down");
    expect(fetchMock).not.toHaveBeenCalled();
    expect(input()).toHaveValue("1ABC");
  });

  it("blocks a malformed symbol on the + button with no request", async () => {
    const fetchMock = stubFetch(() => jsonResponse({}));
    const user = renderWatchlist();
    await user.type(input(), "1abc");
    await user.click(submit());
    expect(screen.getByTestId("add-ticker-error")).toHaveTextContent(FORMAT);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks for a symbol when submitted empty", async () => {
    const fetchMock = stubFetch(() => jsonResponse({}));
    const user = renderWatchlist();
    await user.click(submit());
    expect(screen.getByTestId("add-ticker-error")).toHaveTextContent("Enter a ticker symbol.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("POSTs the ticker and appends the new row at the bottom on 201", async () => {
    const fetchMock = stubFetch(() => jsonResponse(entry("PYPL", 60, 60), 201));
    const user = renderWatchlist();
    await user.type(input(), "pypl{Enter}");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/watchlist");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toEqual({ ticker: "PYPL" });
    expect(rowTickers()).toEqual([
      "watchlist-row-AAPL",
      "watchlist-row-MSFT",
      "watchlist-row-NVDA",
      "watchlist-row-PYPL",
    ]);
    expect(input()).toHaveValue("");
    expect(screen.queryByTestId("add-ticker-error")).toBeNull();
  });

  it("treats a 200 re-add as harmless: one row and a cleared input", async () => {
    stubFetch(() => jsonResponse(entry("AAPL"), 200));
    const user = renderWatchlist();
    await user.type(input(), "aapl{Enter}");
    expect(screen.getAllByTestId("watchlist-row-AAPL")).toHaveLength(1);
    expect(rowTickers()).toHaveLength(3);
    expect(input()).toHaveValue("");
    expect(screen.queryByTestId("add-ticker-error")).toBeNull();
  });

  it("shows a server 400 verbatim, keeps the text, and clears on the next keystroke", async () => {
    stubFetch(() => jsonResponse({ error: CAP }, 400));
    const user = renderWatchlist();
    await user.type(input(), "pypl{Enter}");
    expect(screen.getByTestId("add-ticker-error")).toHaveTextContent(CAP);
    expect(input()).toHaveValue("PYPL");
    expect(rowTickers()).toHaveLength(3);
    await user.type(input(), "X");
    expect(screen.queryByTestId("add-ticker-error")).toBeNull();
    expect(input()).toHaveValue("PYPLX");
  });

  it("shows a network failure message", async () => {
    stubFetch(() => {
      throw new TypeError("Failed to fetch");
    });
    const user = renderWatchlist();
    await user.type(input(), "pypl{Enter}");
    expect(screen.getByTestId("add-ticker-error")).toHaveTextContent(
      "Could not reach the server. Try again.",
    );
  });

  it("disables + while the request is in flight", async () => {
    let release: (res: Response) => void = () => {};
    stubFetch(
      () =>
        new Promise<Response>((resolve) => {
          release = resolve;
        }),
    );
    const user = renderWatchlist();
    await user.type(input(), "pypl{Enter}");
    expect(submit()).toBeDisabled();
    await act(async () => release(jsonResponse(entry("PYPL"), 201)));
    expect(submit()).not.toBeDisabled();
    expect(rowTickers()).toHaveLength(4);
  });
});
