"use client";

// Trade bar (TRD-07): ticker and quantity, then Buy or Sell. Market orders fill instantly at
// the server's cached price, with no confirmation dialog. One inline slot shows the recorded
// fill or the error. Plan 02-05 adds the trade history under the bar in TradePanel.
import { useEffect, useRef, useState } from "react";

import { sanitizeTickerInput, tickerError } from "@/api/ticker";
import type { Side } from "@/api/types";
import { formatPrice } from "@/domain/market";
import { formatQty } from "@/domain/portfolio";
import { usePortfolio } from "@/store/portfolio";

type Message = { kind: "success" | "error"; text: string };

/** How long a fill confirmation stays visible (errors stay until the next edit). */
export const MESSAGE_MS = 3000;

export const QTY_ERROR = "Enter a quantity greater than 0.";

/** Plain decimal with "." as the only separator: "10", "0.5", ".5" (not "1,5", "1e3", "1."). */
const QTY_RE = /^\d*\.?\d+$/;

/** The quantity to send, or null when the text is not a positive plain decimal. */
function parseQty(text: string): number | null {
  const trimmed = text.trim();
  if (!QTY_RE.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const INPUT_CLASS =
  "h-6 min-w-0 rounded-sm border border-border bg-bg px-1.5 font-mono text-xs text-text placeholder:text-muted focus:border-primary focus:outline-none";
const BUTTON_CLASS =
  "h-6 shrink-0 rounded-sm px-3 font-mono text-xs font-semibold text-bg hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-50";

export function TradeBar() {
  const [ticker, setTicker] = useState("");
  const [qty, setQty] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  // The ref mirrors `pending` so a second click in the same tick is ignored too.
  const pendingRef = useRef(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function clearTimer() {
    if (timerRef.current !== null) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }

  /** Replace the message slot; a success message clears itself after MESSAGE_MS. */
  function show(next: Message | null) {
    clearTimer();
    setMessage(next);
    if (next?.kind === "success") {
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        setMessage((current) => (current === next ? null : current));
      }, MESSAGE_MS);
    }
  }

  // Unmounting clears a pending fill-message timer.
  useEffect(() => clearTimer, []);

  async function submit(side: Side) {
    if (pendingRef.current) return;
    // Client checks are UX only; the server's trade rules stay authoritative.
    const symbol = sanitizeTickerInput(ticker);
    const invalidTicker = tickerError(symbol);
    if (invalidTicker) {
      show({ kind: "error", text: invalidTicker });
      return;
    }
    const quantity = parseQty(qty);
    if (quantity === null) {
      show({ kind: "error", text: QTY_ERROR });
      return;
    }
    pendingRef.current = true;
    setPending(true);
    const outcome = await usePortfolio.getState().trade(symbol, quantity, side);
    pendingRef.current = false;
    setPending(false);
    if (outcome.trade) {
      // Built only from the recorded fill, never from the typed quantity or a streamed price.
      const { trade } = outcome;
      const verb = trade.side === "buy" ? "Bought" : "Sold";
      show({
        kind: "success",
        text: `${verb} ${formatQty(trade.quantity)} ${trade.ticker} @ $${formatPrice(trade.price)}`,
      });
      setQty("");
    } else {
      show({ kind: "error", text: outcome.error });
    }
  }

  return (
    <div className="flex flex-col gap-1 px-2 py-1.5">
      <div className="flex items-center gap-1">
        <input
          type="text"
          data-testid="trade-ticker"
          aria-label="Ticker"
          placeholder="Ticker"
          maxLength={10}
          autoComplete="off"
          spellCheck={false}
          value={ticker}
          onChange={(e) => {
            setTicker(sanitizeTickerInput(e.target.value));
            show(null);
          }}
          className={`${INPUT_CLASS} w-20 uppercase placeholder:normal-case`}
        />
        <input
          type="text"
          inputMode="decimal"
          data-testid="trade-qty"
          aria-label="Quantity"
          placeholder="Qty"
          autoComplete="off"
          value={qty}
          onChange={(e) => {
            setQty(e.target.value);
            show(null);
          }}
          className={`${INPUT_CLASS} w-20 text-right`}
        />
        <button
          type="button"
          data-testid="trade-buy"
          disabled={pending}
          onClick={() => void submit("buy")}
          className={`${BUTTON_CLASS} bg-up`}
        >
          Buy
        </button>
        <button
          type="button"
          data-testid="trade-sell"
          disabled={pending}
          onClick={() => void submit("sell")}
          className={`${BUTTON_CLASS} bg-down`}
        >
          Sell
        </button>
      </div>
      {message && (
        <p
          data-testid="trade-message"
          data-kind={message.kind}
          role={message.kind === "error" ? "alert" : "status"}
          className={`text-xs ${message.kind === "error" ? "text-down" : "text-up"}`}
        >
          {message.text}
        </p>
      )}
    </div>
  );
}

export function TradePanel() {
  return (
    <section
      data-testid="panel-trade"
      className="flex min-h-0 flex-col border border-border bg-panel"
    >
      <h2 className="border-b border-border px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
        Trade
      </h2>
      <TradeBar />
    </section>
  );
}
