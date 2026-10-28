import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Header } from "@/components/Header";
import { usePortfolio } from "@/store/portfolio";
import { usePrices } from "@/store/prices";
import { stubApi } from "@/test/stubFetch";

beforeEach(() => {
  usePrices.setState({ ticks: {}, lastTs: {}, spark: {}, status: "connecting" });
  usePortfolio.setState({ cash: null, positions: [], loaded: false, loadError: null });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Header", () => {
  it("shows the wordmark, the connection dot and no buttons", () => {
    render(<Header />);
    const header = screen.getByRole("banner");
    expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(/^FinAlly$/);
    expect(header.querySelectorAll("button")).toHaveLength(0);
    expect(screen.getByTestId("connection-dot")).toBeInTheDocument();
  });

  it("shows Cash as an em dash until the portfolio loads", async () => {
    stubApi();
    render(<Header />);
    const cash = screen.getByTestId("header-cash");
    expect(cash).toHaveTextContent("—");
    expect(cash).toHaveClass("tabular-nums");
    expect(screen.getByRole("banner")).toHaveTextContent("Cash");

    await act(async () => {
      await usePortfolio.getState().loadPortfolio();
    });
    expect(screen.getByTestId("header-cash")).toHaveTextContent("$10,000.00");
  });
});
