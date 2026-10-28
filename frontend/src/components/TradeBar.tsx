"use client";

// Trade bar (TRD-07): ticker and quantity, then Buy or Sell. Market orders fill instantly at
// the server's cached price, with no confirmation dialog. One inline slot shows the recorded
// fill or the error. Plan 02-05 adds the trade history under the bar in TradePanel.
import { useState } from "react";

import { sanitizeTickerInput, tickerError } from "@/api/ticker";
import type { Side } from "@/api/types";
import { formatPrice } from "@/domain/market";
import { formatQty } from "@/domain/portfolio";
import { usePortfolio } from "@/store/portfolio";

type Message = { kind: "success" | "error"; text: string };

const INPUT_CLASS =
  "h-6 min-w-0 rounded-sm border border-border bg-bg px-1.5 font-mono text-xs text-text placeholder:text-muted focus:border-primary focus:outline-none";
const BUTTON_CLASS =
  "h-6 shrink-0 rounded-sm px-3 font-mono text-xs font-semibold text-bg hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-50";

export function TradeBar() {
  const [ticker, setTicker] = useState("");
  const [qty, setQty] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  async function submit(side: Side) {
    if (pending) return;
    // Client checks are UX only; the server's trade rules stay authoritative.
    const invalidTicker = tickerError(ticker);
    if (invalidTicker) {
      setMessage({ kind: "error", text: invalidTicker });
      return;
    }
    const quantity = Number(qty.trim());
    if (qty.trim() === "" || !Number.isFinite(quantity) || quantity <= 0) {
      setMessage({ kind: "error", text: "Enter a quantity greater than 0." });
      return;
    }
    setPending(true);
    const outcome = await usePortfolio.getState().trade(ticker, quantity, side);
    setPending(false);
    if (outcome.trade) {
      const { trade } = outcome;
      const verb = trade.side === "buy" ? "Bought" : "Sold";
      setMessage({
        kind: "success",
        text: `${verb} ${formatQty(trade.quantity)} ${trade.ticker} @ $${formatPrice(trade.price)}`,
      });
      setQty("");
    } else {
      setMessage({ kind: "error", text: outcome.error });
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
            setMessage(null);
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
            setMessage(null);
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
