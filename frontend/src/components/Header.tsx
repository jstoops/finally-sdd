"use client";

// Header: the wordmark, the price-stream status dot and the simulated account's Total, Cash
// and P&L since start (PF-04, PF-05).
import { useMemo } from "react";

import type { StreamStatus } from "@/api/types";
import type { Sign } from "@/domain/market";
import { formatMoney, formatSignedMoney, livePortfolio, moneySign } from "@/domain/portfolio";
import { usePortfolio } from "@/store/portfolio";
import { usePrices } from "@/store/prices";

const DOT: Record<StreamStatus, { className: string; label: string }> = {
  open: { className: "bg-up", label: "Price stream connected" },
  connecting: { className: "bg-accent", label: "Price stream reconnecting" },
  closed: { className: "bg-down", label: "Price stream disconnected" },
};

export function ConnectionDot() {
  const status = usePrices((s) => s.status);
  const { className, label } = DOT[status];
  return (
    <span
      data-testid="connection-dot"
      data-status={status}
      role="status"
      aria-label={label}
      title={label}
      className={`inline-block h-2 w-2 shrink-0 rounded-full ${className}`}
    />
  );
}

const SIGN_CLASS = { up: "text-up", down: "text-down", flat: "text-muted" } as const;

function Readout({
  label,
  testId,
  value,
  sign,
  className = "",
}: {
  label: string;
  testId: string;
  value: string;
  sign?: Sign;
  className?: string;
}) {
  return (
    <div className="flex items-baseline gap-1.5">
      <span className="text-muted">{label}</span>
      <span
        data-testid={testId}
        data-sign={sign}
        className={`font-mono tabular-nums ${className}`}
      >
        {value}
      </span>
    </div>
  );
}

export function Header() {
  // Raw-field selectors only; derived values come from useMemo so no selector returns a new
  // object per render (Pitfall 8). Total and P&L follow every SSE frame without any polling.
  const cash = usePortfolio((s) => s.cash);
  const positions = usePortfolio((s) => s.positions);
  const ticks = usePrices((s) => s.ticks);
  const live = useMemo(
    () => (cash === null ? null : livePortfolio(cash, positions, ticks)),
    [cash, positions, ticks],
  );
  const pnlSign = live ? moneySign(live.pnlSinceStart) : "flat";

  return (
    <header className="flex h-9 items-center gap-2 border-b border-border bg-panel px-3">
      <h1 className="font-mono font-semibold text-accent">FinAlly</h1>
      <ConnectionDot />
      <div className="ml-auto flex items-baseline gap-4 text-xs">
        <Readout label="Total" testId="header-total" value={formatMoney(live?.total)} />
        <Readout label="Cash" testId="header-cash" value={formatMoney(cash)} />
        <Readout
          label="P&L since start"
          testId="header-pnl"
          value={live ? formatSignedMoney(live.pnlSinceStart) : "—"}
          sign={pnlSign}
          className={SIGN_CLASS[pnlSign]}
        />
      </div>
    </header>
  );
}
