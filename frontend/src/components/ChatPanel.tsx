"use client";

// AI chat panel (AI-11 to AI-16, UX-02): the conversation reloaded from the server on mount, an
// inline chip per action the assistant ran (failed ones visibly distinct), error bubbles,
// starter prompts in an empty chat, a loading row, Enter to send and a collapse toggle.
// Content renders as plain React text with preserved whitespace: never as HTML or markdown.
// After a reply that ran actions, or a failure after which the server may have run some (a 5xx
// or a lost response), this component refreshes the portfolio and the watchlist stores (the
// stores never import each other). Sends are blocked while an account reset runs.
import { type FormEvent, type KeyboardEvent, useEffect, useId, useRef, useState } from "react";

import type { ChatActions, ChatMessage, TradeAction, WatchlistAction } from "@/api/types";
import { formatPrice } from "@/domain/market";
import { formatQty } from "@/domain/portfolio";
import { type ChatEntry, useChat, validateChatMessage } from "@/store/chat";
import { usePortfolio } from "@/store/portfolio";
import { useWatchlist } from "@/store/watchlist";

/** Starter prompts shown in an empty chat (AI-16); a click sends the label as written. */
export const PROMPTS = [
  "Analyze my portfolio",
  "Buy 5 NVDA",
  "Add PYPL to my watchlist",
] as const;

const DASH = "—";

const CHIP_CLASS = {
  executed: "border-border text-text",
  failed: "border-down text-down",
} as const;

function tradeText(action: TradeAction): string {
  const side = action.side ? action.side.toUpperCase() : DASH;
  const qty = formatQty(action.quantity);
  const ticker = action.ticker ?? DASH;
  if (action.status === "executed") {
    const price = typeof action.price === "number" ? `$${formatPrice(action.price)}` : DASH;
    return `${side} ${qty} ${ticker} @ ${price}`;
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
  error,
}: {
  kind: "trade" | "watchlist";
  status: TradeAction["status"];
  text: string;
  error?: string;
}) {
  return (
    <li
      data-testid="chat-action"
      data-kind={kind}
      data-status={status}
      title={status === "failed" ? error : undefined}
      className={`whitespace-pre-wrap break-words rounded-sm border px-1.5 py-0.5 font-mono text-xs ${CHIP_CLASS[status]}`}
    >
      {text}
    </li>
  );
}

/** One renderer for live and stored replies: watchlist changes first, then trades. */
function ActionChips({ actions }: { actions: ChatActions }) {
  const watchlist = actions.watchlist_changes ?? [];
  const trades = actions.trades ?? [];
  if (watchlist.length === 0 && trades.length === 0) return null;
  return (
    <ul className="mt-1 flex flex-col gap-0.5">
      {watchlist.map((action, i) => (
        <Chip
          key={`w-${i}`}
          kind="watchlist"
          status={action.status}
          text={watchlistText(action)}
          error={action.error}
        />
      ))}
      {trades.map((action, i) => (
        <Chip
          key={`t-${i}`}
          kind="trade"
          status={action.status}
          text={tradeText(action)}
          error={action.error}
        />
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
      className={`self-stretch whitespace-pre-wrap break-words text-center text-xs ${
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
  const collapsed = useChat((s) => s.collapsed);
  const toggleCollapsed = useChat((s) => s.toggleCollapsed);
  const resetting = usePortfolio((s) => s.resetting);
  const settled = useChat((s) => s.settled);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLUListElement>(null);
  const bodyId = useId();

  // Reload the stored conversation once (AI-11).
  useEffect(() => {
    void useChat.getState().loadHistory();
  }, []);

  // Keep the newest entry in view. scrollTop, not scrollIntoView (absent in jsdom, Pitfall 8).
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [entries.length, pending, collapsed]);

  /**
   * Shared by Enter, the Send button and the prompt chips; one request in flight at most, and
   * none while a reset runs or before the first history load settles (the draft is kept). A
   * send during the history load would make the store discard the stored conversation.
   */
  async function submit(message: string, fromDraft: boolean) {
    const chat = useChat.getState();
    if (chat.pending || !chat.settled || usePortfolio.getState().resetting) return;
    if (fromDraft && validateChatMessage(message) === null) setText("");
    const result = await useChat.getState().send(message);
    const acted =
      result.kind === "reply"
        ? !!result.reply.actions
        : result.kind === "failed" && result.mayHaveActed;
    if (acted) {
      void usePortfolio.getState().refresh();
      void useWatchlist.getState().loadWatchlist();
    }
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void submit(text, true);
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter keeps the newline; Enter that confirms an IME candidate is ignored.
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    void submit(text, true);
  }

  const showPrompts = settled && entries.length === 0 && !pending && !resetting;

  return (
    <section
      data-testid="panel-chat"
      data-collapsed={collapsed ? "true" : "false"}
      className={`flex min-h-0 flex-col border border-border bg-panel ${className}`}
    >
      <div
        className={`flex items-center gap-1 border-b border-border px-2 py-1 ${
          collapsed ? "xl:flex-col xl:border-b-0 xl:px-0" : ""
        }`}
      >
        <h2
          data-testid="chat-title"
          className={`text-xs font-semibold uppercase tracking-wide text-muted ${
            collapsed ? "xl:order-last xl:[writing-mode:vertical-rl]" : ""
          }`}
        >
          AI Chat
        </h2>
        <button
          type="button"
          data-testid="chat-toggle"
          aria-expanded={!collapsed}
          aria-controls={bodyId}
          aria-label={collapsed ? "Expand AI chat" : "Collapse AI chat"}
          title={collapsed ? "Expand AI chat" : "Collapse AI chat"}
          onClick={toggleCollapsed}
          className={`-my-1 ml-auto inline-flex h-6 min-w-6 items-center justify-center rounded-sm px-1.5 font-mono text-xs text-muted hover:text-accent focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary ${
            collapsed ? "xl:mx-auto xl:my-0" : ""
          }`}
        >
          {collapsed ? "«" : "»"}
        </button>
      </div>
      {!collapsed && (
        <div id={bodyId} className="flex min-h-0 flex-1 flex-col">
          <ul
            ref={listRef}
            data-testid="chat-list"
            className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-y-auto p-2"
          >
            {entries.map((entry) => (
              <EntryRow
                key={entry.kind === "message" ? entry.message.id : entry.id}
                entry={entry}
              />
            ))}
            {pending && (
              <li
                data-testid="chat-loading"
                role="status"
                className="self-start animate-pulse text-xs text-muted"
              >
                FinAlly is thinking…
              </li>
            )}
          </ul>
          {showPrompts && (
            <div className="flex flex-wrap gap-1 px-2 pb-1.5">
              {PROMPTS.map((prompt) => (
                <button
                  key={prompt}
                  type="button"
                  data-testid="chat-prompt"
                  onClick={() => void submit(prompt, false)}
                  className="rounded-sm border border-border px-1.5 py-0.5 text-xs text-muted hover:border-primary hover:text-text focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary"
                >
                  {prompt}
                </button>
              ))}
            </div>
          )}
          <form onSubmit={onSubmit} className="flex gap-1 border-t border-border p-1.5">
            <textarea
              data-testid="chat-input"
              aria-label="Message FinAlly"
              placeholder="Ask FinAlly…"
              rows={2}
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={onKeyDown}
              className="min-w-0 flex-1 resize-none rounded-sm border border-border bg-bg px-1.5 py-1 text-xs text-text placeholder:text-muted focus:border-primary focus:outline-none"
            />
            <button
              type="submit"
              data-testid="chat-send"
              disabled={pending || resetting || !settled}
              title={resetting ? "Wait for the reset to finish" : undefined}
              className="shrink-0 self-end rounded-sm bg-submit px-3 py-1 text-xs font-semibold text-text hover:brightness-110 focus-visible:outline focus-visible:outline-1 focus-visible:outline-primary disabled:cursor-wait disabled:opacity-50"
            >
              Send
            </button>
          </form>
        </div>
      )}
    </section>
  );
}
