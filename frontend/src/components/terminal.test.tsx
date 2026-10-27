import { act, render, screen } from "@testing-library/react";
import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { StreamStatus } from "@/api/types";
import Home from "@/app/page";
import { ConnectionDot, Header } from "@/components/Header";
import { usePrices } from "@/store/prices";
import { FakeEventSource } from "@/test/FakeEventSource";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function stubFetch(body: unknown) {
  const fetchMock = vi.fn(async () => jsonResponse(body));
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

beforeEach(() => {
  usePrices.setState({ ticks: {}, status: "connecting" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("ConnectionDot", () => {
  const cases: [StreamStatus, string, string][] = [
    ["open", "bg-up", "Price stream connected"],
    ["connecting", "bg-accent", "Price stream reconnecting"],
    ["closed", "bg-down", "Price stream disconnected"],
  ];

  it.each(cases)("status %s renders %s with price-stream wording", (status, cls, label) => {
    render(<ConnectionDot />);
    act(() => usePrices.setState({ status }));
    const dot = screen.getByTestId("connection-dot");
    expect(dot).toHaveAttribute("data-status", status);
    expect(dot).toHaveClass(cls);
    expect(dot).toHaveAttribute("aria-label", label);
    expect(dot).toHaveAttribute("title", label);
    expect(dot).toHaveAttribute("role", "status");
  });

  it("follows the stream through connect, open, reconnect and close", () => {
    render(<ConnectionDot />);
    const dot = screen.getByTestId("connection-dot");
    for (const status of ["connecting", "open", "connecting", "closed", "open"] as const) {
      act(() => usePrices.setState({ status }));
      expect(dot).toHaveAttribute("data-status", status);
    }
  });
});

describe("Header", () => {
  it("shows only the wordmark and the connection dot", () => {
    render(<Header />);
    const header = screen.getByRole("banner");
    expect(header).toHaveTextContent(/^FinAlly$/);
    expect(header.querySelectorAll("button")).toHaveLength(0);
    expect(screen.getByTestId("connection-dot")).toBeInTheDocument();
  });
});

describe("page", () => {
  it("leaves exactly one open EventSource under StrictMode", async () => {
    stubFetch({ tickers: [] });
    render(
      <StrictMode>
        <Home />
      </StrictMode>,
    );
    await act(async () => {});
    expect(FakeEventSource.open()).toHaveLength(1);
    const [first] = FakeEventSource.instances;
    if (FakeEventSource.instances.length > 1) expect(first.closed).toBe(true);
  });
});
