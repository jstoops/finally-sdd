"use client";

// AI chat panel (AI-01, AI-13, AI-15): the conversation, an inline chip per action the
// assistant ran (failed ones visibly distinct), and the message box. Content renders as
// plain React text with preserved whitespace: never as HTML or markdown. After a reply
// that ran actions, this component refreshes the portfolio and the watchlist stores (the
// stores never import each other).
import { type FormEvent, useState } from "react";

import type { ChatActions, ChatMessage, TradeAction, WatchlistAction } from "@/api/types";
import { formatPrice } from "@/domain/market";
import { formatQty } from "@/domain/portfolio";
import { type ChatEntry, useChat } from "@/store/chat";
import { usePortfolio } from "@/store/portfolio";
import { useWatchlist } from "@/store/watchlist";

const DASH = "—";

const CHIP_CLASS = {
  executed: "border-border text-text",
  failed: "border-down text-down",
} as const;

function tradeText(action: TradeAction): string {
  const side = action.side ? action.side.toUpperCase() : DASH;
  const qty = action.quantity === null ? DASH : formatQty(action.quantity);
  const ticker = action.ticker ?? DASH;
  if (action.status === "executed") {
    return `${side} ${qty} ${ticker} @ $${formatPrice(action.price)}`;
  }
  return `⚠ ${side} ${qty} ${ticker}: ${action.error ?? "failed"}`;
}

function watchlistText(action: WatchlistAction): string {
  const ticker = action.ticker ?? DASH;
  if (action.status === "executed") {
    return `${action.action === "remove" ? "−" : "+"} ${ticker} watchlist`;
  }
  return `⚠ ${action.action ?? DASH} ${ticker}: ${action.error ?? "failed"}`;
}

function Chip({
  kind,
  status,
  text,
}: {
  kind: "trade" | "watchlist";
  status: TradeAction["status"];
  text: string;
}) {
  return (
    <li
      data-testid="chat-action"
      data-kind={kind}
      data-status={status}
      className={`rounded-sm border px-1.5 py-0.5 font-mono text-[11px] ${CHIP_CLASS[status]}`}
    >
      {text}
    </li>
  );
}

function ActionChips({ actions }: { actions: ChatActions }) {
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {actions.watchlist_changes.map((action, i) => (
        <Chip
          key={`w-${i}`}
          kind="watchlist"
          status={action.status}
          text={watchlistText(action)}
        />
      ))}
      {actions.trades.map((action, i) => (
        <Chip key={`t-${i}`} kind="trade" status={action.status} text={tradeText(action)} />
      ))}
    </ul>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user";
  return (
    <li
      data-testid="chat-message"
      data-role={message.role}
      className={`max-w-[90%] rounded-sm px-2 py-1 text-xs ${
        isUser ? "self-end bg-primary/20 text-text" : "self-start border border-border bg-bg"
      }`}
    >
      <p className="whitespace-pre-wrap break-words">{message.content}</p>
      {!isUser && message.actions && <ActionChips actions={message.actions} />}
    </li>
  );
}

function EntryRow({ entry }: { entry: ChatEntry }) {
  if (entry.kind === "message") return <MessageBubble message={entry.message} />;
  return (
    <li
      data-testid="chat-system"
      data-tone={entry.tone}
      role={entry.tone === "error" ? "alert" : undefined}
      className={`self-stretch whitespace-pre-wrap text-center text-[11px] ${
        entry.tone === "error" ? "text-down" : "text-muted"
      }`}
    >
      {entry.text}
    </li>
  );
}

export function ChatPanel({ className = "" }: { className?: string }) {
  const entries = useChat((s) => s.entries);
  const pending = useChat((s) => s.pending);
  const [text, setText] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending || text.trim() === "") return;
    setText("");
    const reply = await useChat.getState().send(text);
    if (reply?.actions) {
      void usePortfolio.getState().refresh();
      void useWatchlist.getState().loadWatchlist();
    }
  }

  return (
    <section
      data-testid="panel-chat"
      className={`flex min-h-0 flex-col border border-border bg-panel ${className}`}
    >
      <h2 className="border-b border-border px-2 py-1 text-xs font-semibold uppercase tracking-wide text-muted">
        AI Chat
      </h2>
      <ul
        data-testid="chat-list"
        className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2"
      >
        {entries.map((entry) => (
          <EntryRow
            key={entry.kind === "message" ? entry.message.id : entry.id}
            entry={entry}
          />
        ))}
      </ul>
      <form onSubmit={(e) => void submit(e)} className="flex gap-1 border-t border-border p-1.5">
        <textarea
          data-testid="chat-input"
          aria-label="Message FinAlly"
          placeholder="Ask FinAlly…"
          rows={2}
          value={text}
          onChange={(e) => setText(e.target.value)}
          className="min-w-0 flex-1 resize-none rounded-sm border border-border bg-bg px-1.5 py-1 text-xs text-text placeholder:text-muted focus:border-primary focus:outline-none"
        />
        <button
          type="submit"
          data-testid="chat-send"
          disabled={pending}
          className="shrink-0 self-end rounded-sm bg-submit px-3 py-1 text-xs font-semibold text-text hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-50"
        >
          Send
        </button>
      </form>
    </section>
  );
}
