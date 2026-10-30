"use client";

// Portfolio heatmap (PF-07): one tile per position, laid out by the in-house squarify and
// sized by live market value, shaded on a diverging scale by live P&L %. Recomputed from
// stored positions x SSE prices on every frame (PLAN §10; no polling). A tile click charts
// the ticker, including a held but unwatched one (MD-08).
import { useEffect, useMemo, useRef, useState } from "react";

import { formatPct } from "@/domain/market";
import { livePortfolio, pctSign, pnlColor } from "@/domain/portfolio";
import { squarify } from "@/domain/treemap";
import { usePortfolio } from "@/store/portfolio";
import { usePrices } from "@/store/prices";
import { useWatchlist } from "@/store/watchlist";

/** Smallest tile, as a fraction of the box, that still shows its label (assumption A6). */
const LABEL_MIN_W = 0.06;
const LABEL_MIN_H = 0.18;

/** Layout box before the first measurement: 16:9 (assumption D-2). */
const DEFAULT_BOX = { w: 16, h: 9 };

const EMPTY_TEXT = "No positions — buy something or ask FinAlly";

export function Heatmap() {
  // Raw-field selectors only; rows and tiles derive through useMemo (Pitfall 8).
  const cash = usePortfolio((s) => s.cash);
  const positions = usePortfolio((s) => s.positions);
  const ticks = usePrices((s) => s.ticks);
  const boxRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState(DEFAULT_BOX);

  // ResizeObserver is a browser API: touch it only inside an effect (static export).
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (rect && rect.width > 0 && rect.height > 0) {
        setBox({ w: rect.width, h: rect.height });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const rows = useMemo(
    () => livePortfolio(cash ?? 0, positions, ticks).rows,
    [cash, positions, ticks],
  );
  const tiles = useMemo(
    () =>
      squarify(
        rows.map((r) => ({ key: r.ticker, value: r.market_value })),
        box.w,
        box.h,
      ),
    [rows, box],
  );
  const pctByTicker = useMemo(
    () => new Map(rows.map((r) => [r.ticker, r.unrealized_pnl_percent])),
    [rows],
  );

  return (
    <section
      data-testid="panel-heatmap"
      className="flex min-h-0 flex-col border border-border bg-panel"
    >
      <h2 className="border-b border-border px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
        Heatmap
      </h2>
      <div ref={boxRef} className="relative min-h-0 flex-1 overflow-hidden">
        {tiles.map((t) => {
          const pct = pctByTicker.get(t.key) ?? 0;
          const label = `${t.key} ${formatPct(pct)}`;
          const showLabel = t.w / box.w >= LABEL_MIN_W && t.h / box.h >= LABEL_MIN_H;
          return (
            <button
              key={t.key}
              type="button"
              data-testid={`heatmap-tile-${t.key}`}
              data-sign={pctSign(pct)}
              title={label}
              onClick={() => useWatchlist.getState().select(t.key)}
              className="absolute flex flex-col items-center justify-center overflow-hidden border border-bg font-mono text-xs leading-tight text-text hover:brightness-125 focus-visible:z-10 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
              style={{
                left: `${(t.x / box.w) * 100}%`,
                top: `${(t.y / box.h) * 100}%`,
                width: `${(t.w / box.w) * 100}%`,
                height: `${(t.h / box.h) * 100}%`,
                backgroundColor: pnlColor(pct),
              }}
            >
              {showLabel && (
                <>
                  <span className="font-semibold">{t.key}</span>
                  <span className="tabular-nums">{formatPct(pct)}</span>
                </>
              )}
            </button>
          );
        })}
        {rows.length === 0 && (
          <p
            data-testid="heatmap-empty"
            className="absolute inset-0 flex items-center justify-center p-3 text-center text-xs text-muted"
          >
            {EMPTY_TEXT}
          </p>
        )}
      </div>
    </section>
  );
}
