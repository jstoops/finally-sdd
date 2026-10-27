"use client";

// Phase 1 header (D-02): the wordmark and the price-stream status dot, nothing else.
import type { StreamStatus } from "@/api/types";
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
  return (
    <header className="flex h-9 items-center gap-2 border-b border-border bg-panel px-3">
      <h1 className="font-mono font-semibold text-accent">FinAlly</h1>
      <ConnectionDot />
    </header>
  );
}
