"use client";

// Dense watchlist (D-03): one ~28px row per ticker with price flash (MD-03), Chg % since
// session open (MD-02), an SVG sparkline (MD-05) and selection styling (D-04, MD-07).
// The add form is pinned under the title (D-05) and shares one inline error slot (D-07, D-08).
import { type FormEvent, memo, useState } from "react";

import { sanitizeTickerInput } from "@/api/ticker";
import type { WatchlistEntry } from "@/api/types";
import { chgPercent, formatPct, formatPrice, signOf, sparkPoints } from "@/domain/market";
import { usePrices } from "@/store/prices";
import { useWatchlist } from "@/store/watchlist";

const SPARK_W = 64;
const SPARK_H = 18;
const EMPTY: readonly number[] = [];

const CHG_CLASS = { up: "text-up", down: "text-down", flat: "text-muted" } as const;

export function Sparkline({
  ticker,
  values,
  rising,
}: {
  ticker: string;
  values: readonly number[];
  rising: boolean;
}) {
  const points = sparkPoints(values, SPARK_W, SPARK_H);
  return (
    <svg
      data-testid={`spark-${ticker}`}
      width={SPARK_W}
      height={SPARK_H}
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      className="block overflow-visible"
      aria-hidden="true"
    >
      {points && (
        <polyline
          points={points}
          fill="none"
          strokeWidth={1}
          className={rising ? "stroke-up" : "stroke-down"}
        />
      )}
    </svg>
  );
}

export const WatchlistRow = memo(function WatchlistRow({ entry }: { entry: WatchlistEntry }) {
  const { ticker } = entry;
  const tick = usePrices((s) => s.ticks[ticker]);
  const spark = usePrices((s) => s.spark[ticker]) ?? EMPTY;
  const selected = useWatchlist((s) => s.selected === ticker);
  const select = useWatchlist((s) => s.select);

  const price = tick?.price ?? entry.price;
  const open = tick?.open_price ?? entry.open_price;
  const chg = chgPercent(price, open);
  const sign = signOf(chg);
  // Derived in render (no setState in an effect): keying the span by the tick timestamp
  // remounts it on every new tick, which restarts the 500ms CSS flash.
  const flash = tick && tick.direction !== "flat" ? `flash-${tick.direction}` : "";
  const rising = price !== null && open !== null && price >= open;

  return (
    <li data-testid={`watchlist-row-${ticker}`} className="group relative">
      <button
        type="button"
        data-testid={`select-${ticker}`}
        aria-pressed={selected}
        onClick={() => select(ticker)}
        className={`grid h-7 w-full grid-cols-[minmax(0,1fr)_4rem_3.5rem_64px] items-center gap-1 border-l-2 px-2 text-left font-mono text-xs hover:bg-white/5 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${
          selected ? "border-primary bg-primary/10" : "border-transparent"
        }`}
      >
        <span className="truncate font-semibold text-text">{ticker}</span>
        <span className="text-right">
          <span
            key={tick?.timestamp ?? "rest"}
            data-testid={`price-${ticker}`}
            data-direction={tick?.direction ?? "flat"}
            className={`rounded-sm px-0.5 tabular-nums text-text ${flash}`}
          >
            {formatPrice(price)}
          </span>
        </span>
        <span
          data-testid={`chg-${ticker}`}
          data-sign={sign}
          className={`text-right tabular-nums ${CHG_CLASS[sign]}`}
        >
          {formatPct(chg)}
        </span>
        <Sparkline ticker={ticker} values={spark} rising={rising} />
      </button>
    </li>
  );
});

export function AddTickerForm({
  error,
  onError,
}: {
  error: string | null;
  onError: (message: string | null) => void;
}) {
  const addTicker = useWatchlist((s) => s.addTicker);
  const [value, setValue] = useState("");
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    setPending(true);
    const message = await addTicker(value);
    setPending(false);
    // On error the typed text stays so the user can fix it (D-07).
    if (message === null) setValue("");
    onError(message);
  }

  return (
    <form onSubmit={onSubmit} className="border-b border-border px-2 py-1" noValidate>
      <div className="flex items-center gap-1">
        <input
          type="text"
          data-testid="add-ticker-input"
          aria-label="Add ticker"
          placeholder="Add ticker"
          maxLength={10}
          autoComplete="off"
          spellCheck={false}
          value={value}
          onChange={(e) => {
            setValue(sanitizeTickerInput(e.target.value));
            onError(null);
          }}
          className="h-6 min-w-0 flex-1 rounded-sm border border-border bg-bg px-1.5 font-mono text-xs uppercase text-text placeholder:normal-case placeholder:text-muted focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          data-testid="add-ticker-submit"
          aria-label="Add ticker"
          disabled={pending}
          className="h-6 w-6 shrink-0 rounded-sm bg-submit font-mono text-sm font-semibold leading-none text-text hover:brightness-125 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-50"
        >
          +
        </button>
      </div>
      {error && (
        <p data-testid="add-ticker-error" role="alert" className="pt-0.5 text-xs text-down">
          {error}
        </p>
      )}
    </form>
  );
}

export function Watchlist() {
  const entries = useWatchlist((s) => s.entries);
  const loaded = useWatchlist((s) => s.loaded);
  const loadError = useWatchlist((s) => s.loadError);
  // One inline error slot for client format errors and every server 400 (D-07, D-08).
  const [error, setError] = useState<string | null>(null);

  return (
    <section
      data-testid="panel-watchlist"
      className="flex min-h-0 flex-col border border-border bg-panel"
    >
      <h2 className="border-b border-border px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
        Watchlist
      </h2>
      <AddTickerForm error={error} onError={setError} />
      {loadError && <p className="px-2 py-1 text-xs text-down">{loadError}</p>}
      <ul data-testid="watchlist" className="min-h-0 flex-1 overflow-y-auto">
        {entries.map((entry) => (
          <WatchlistRow key={entry.ticker} entry={entry} />
        ))}
      </ul>
      {loaded && !loadError && entries.length === 0 && (
        <p className="px-2 py-3 text-center text-xs text-muted">Your watchlist is empty</p>
      )}
    </section>
  );
}
