// URL-routing fetch stub for component tests. A route key is "METHOD /path" or "/path";
// a route value is a JSON body or a function of the request init that returns a Response or
// a body (and may throw to simulate a network failure). Anything unmatched gets a 404.
import { vi } from "vitest";

import type { Portfolio } from "@/api/types";

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export type RouteHandler = (init?: RequestInit) => unknown;
export type Routes = Record<string, unknown>;

const EMPTY_PORTFOLIO: Portfolio = {
  cash_balance: 10000,
  positions_value: 0,
  total_value: 10000,
  unrealized_pnl: 0,
  positions: [],
};

/** Default routes: an empty watchlist, a fresh $10,000 account and no history. */
export const DEFAULT_API: Readonly<Routes> = {
  "GET /api/watchlist": { tickers: [] },
  "GET /api/portfolio": EMPTY_PORTFOLIO,
  "GET /api/trades": { trades: [] },
  "GET /api/portfolio/history": { snapshots: [] },
};

const HISTORY_PATH = /^\/api\/prices\/([^/]+)\/history$/;

function lookup(routes: Routes, method: string, path: string): { found: boolean; value: unknown } {
  const keyed = `${method} ${path}`;
  if (keyed in routes) return { found: true, value: routes[keyed] };
  if (path in routes) return { found: true, value: routes[path] };
  return { found: false, value: undefined };
}

/**
 * Install a routing fetch mock with `vi.stubGlobal` and return it. Overrides are matched
 * before the defaults; within each, "METHOD /path" before "/path". Any
 * /api/prices/{T}/history request falls back to `{ticker, points: []}`.
 */
export function stubApi(overrides: Routes = {}) {
  const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const path = String(input).split("?")[0];
    const method = (init?.method ?? "GET").toUpperCase();
    let route = lookup(overrides, method, path);
    if (!route.found) route = lookup(DEFAULT_API, method, path);
    if (!route.found) {
      const history = HISTORY_PATH.exec(path);
      if (history && method === "GET") {
        route = { found: true, value: { ticker: decodeURIComponent(history[1]), points: [] } };
      }
    }
    if (!route.found) return jsonResponse({ error: "Not found" }, 404);
    const value =
      typeof route.value === "function" ? await (route.value as RouteHandler)(init) : route.value;
    return value instanceof Response ? value : jsonResponse(value);
  });
  vi.stubGlobal("fetch", mock);
  return mock;
}

/** Calls the mock received for `path` (query string ignored), optionally by method. */
export function callsTo(mock: ReturnType<typeof stubApi>, path: string, method = "GET") {
  return mock.mock.calls.filter(([input, init]) => {
    const m = ((init as RequestInit | undefined)?.method ?? "GET").toUpperCase();
    return String(input).split("?")[0] === path && m === method;
  });
}
