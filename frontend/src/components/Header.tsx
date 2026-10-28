"use client";

// Header: the wordmark, the price-stream status dot and the account's Cash readout.
import type { StreamStatus } from "@/api/types";
import { formatMoney } from "@/domain/portfolio";
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

export function Header() {
  const cash = usePortfolio((s) => s.cash);
  return (
    <header className="flex h-9 items-center gap-2 border-b border-border bg-panel px-3">
      <h1 className="font-mono font-semibold text-accent">FinAlly</h1>
      <ConnectionDot />
      <div className="ml-auto flex items-baseline gap-1.5 text-xs">
        <span className="text-muted">Cash</span>
        <span data-testid="header-cash" className="font-mono tabular-nums">
          {formatMoney(cash)}
        </span>
      </div>
    </header>
  );
}
