import { act, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatActions, ChatHistoryResponse, ChatMessage } from "@/api/types";
import { ChatPanel, PROMPTS } from "@/components/ChatPanel";
import { useChat } from "@/store/chat";
import { usePortfolio } from "@/store/portfolio";
import { useWatchlist } from "@/store/watchlist";
import { callsTo, jsonResponse, type Routes, stubApi } from "@/test/stubFetch";

const NOT_CONFIGURED = "AI assistant is not configured. Set OPENROUTER_API_KEY in .env.";

function messageOf(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m-2",
    role: "assistant",
    content: "Done.",
    actions: null,
    created_at: "2026-10-09T14:03:22Z",
    ...overrides,
  };
}

function actionsOf(overrides: Partial<ChatActions> = {}): ChatActions {
  return { trades: [], watchlist_changes: [], ...overrides };
}

/** A route handler whose response the test releases later. */
function deferred<T>() {
  let release: (body: T) => void = () => {};
  const handler = vi.fn(
    () =>
      new Promise<T>((resolve) => {
        release = resolve;
      }),
  );
  return { handler, release: (body: T) => release(body) };
}

const input = () => screen.getByTestId("chat-input") as HTMLTextAreaElement;
const sendButton = () => screen.getByTestId("chat-send");
const chips = () => screen.queryAllByTestId("chat-action");
const chipTexts = () => chips().map((c) => c.textContent);
const systems = () => screen.queryAllByTestId("chat-system");
const assistantBubbles = () =>
  screen.getAllByTestId("chat-message").filter((m) => m.getAttribute("data-role") === "assistant");

async function renderPanel(routes: Routes = {}) {
  const fetchMock = stubApi(routes);
  render(<ChatPanel />);
  await act(async () => {});
  return fetchMock;
}

/** Render with stored messages (the history route) so chips can be inspected. */
async function renderHistory(messages: ChatMessage[], routes: Routes = {}) {
  return renderPanel({ "GET /api/chat/history": { messages }, ...routes });
}

function type(text: string) {
  fireEvent.change(input(), { target: { value: text } });
}

async function pressEnter(init: Partial<KeyboardEventInit> = {}) {
  await act(async () => {
    fireEvent.keyDown(input(), { key: "Enter", code: "Enter", ...init });
  });
  await act(async () => {});
}

async function typeAndEnter(text: string) {
  type(text);
  await pressEnter();
}

const chatPosts = (fetchMock: ReturnType<typeof stubApi>) =>
  callsTo(fetchMock, "/api/chat", "POST");

const postedMessage = (fetchMock: ReturnType<typeof stubApi>, index = 0) =>
  JSON.parse(String((chatPosts(fetchMock)[index][1] as RequestInit).body)).message;

beforeEach(() => {
  useChat.setState({ entries: [], pending: false, loaded: false, settled: false, collapsed: false });
  usePortfolio.setState({
    cash: null,
    positions: [],
    loaded: false,
    loadError: null,
    resetting: false,
  });
  useWatchlist.setState({ entries: [], loaded: false, loadError: null, selected: null, held: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("history", () => {
  const STORED: ChatMessage[] = [
    messageOf({ id: "h-1", role: "user", content: "buy" }),
    messageOf({
      id: "h-2",
      content: "Buying 1 share of AAPL.",
      actions: actionsOf({
        trades: [{ ticker: "AAPL", side: "buy", quantity: 1, status: "executed", price: 190.52 }],
        watchlist_changes: [{ ticker: "PYPL", action: "add", status: "failed", error: "Nope." }],
      }),
    }),
  ];

  it("loads the history once on mount and renders each message and chip", async () => {
    const fetchMock = await renderHistory(STORED);
    expect(callsTo(fetchMock, "/api/chat/history")).toHaveLength(1);
    const messages = screen.getAllByTestId("chat-message");
    expect(messages.map((m) => m.getAttribute("data-role"))).toEqual(["user", "assistant"]);
    expect(messages[0]).toHaveTextContent("buy");
    expect(chipTexts()).toEqual(["⚠ add PYPL: Nope.", "BUY 1 AAPL @ $190.52"]);
  });

  it("renders stored chips exactly like live ones", async () => {
    const live = messageOf({ ...STORED[1], id: "m-9" });
    await renderHistory(STORED, { "POST /api/chat": live });
    const stored = chips().map((c) => c.outerHTML);
    await typeAndEnter("buy");
    const all = chips().map((c) => c.outerHTML);
    expect(all).toHaveLength(4);
    expect(all.slice(2)).toEqual(stored);
  });

  it("blocks sends and hides the prompts until the history load settles, keeping the history", async () => {
    const history = deferred<ChatHistoryResponse>();
    const fetchMock = await renderPanel({
      "GET /api/chat/history": history.handler,
      "POST /api/chat": messageOf({ id: "m-9", content: "Hi there." }),
    });
    expect(sendButton()).toBeDisabled();
    expect(screen.queryAllByTestId("chat-prompt")).toHaveLength(0);
    await typeAndEnter("hello");
    expect(chatPosts(fetchMock)).toHaveLength(0);
    expect(input().value).toBe("hello");

    await act(async () => history.release({ messages: STORED }));
    expect(sendButton()).not.toBeDisabled();
    await pressEnter();
    expect(chatPosts(fetchMock)).toHaveLength(1);
    const messages = screen.getAllByTestId("chat-message");
    expect(messages.map((m) => m.textContent?.slice(0, 9))).toEqual([
      "buy",
      "Buying 1 ",
      "hello",
      "Hi there.",
    ]);
  });

  it("shows the prompts once an empty history load settles", async () => {
    const history = deferred<ChatHistoryResponse>();
    await renderPanel({ "GET /api/chat/history": history.handler });
    expect(screen.queryAllByTestId("chat-prompt")).toHaveLength(0);
    await act(async () => history.release({ messages: [] }));
    expect(screen.getAllByTestId("chat-prompt")).toHaveLength(PROMPTS.length);
  });

  it("shows a failed history load as an error bubble and stays usable", async () => {
    const fetchMock = await renderPanel({
      "GET /api/chat/history": () => jsonResponse({ error: "Database busy" }, 500),
      "POST /api/chat": messageOf({ content: "Hi there." }),
    });
    expect(systems()).toHaveLength(1);
    expect(systems()[0]).toHaveTextContent("Database busy");
    expect(systems()[0]).toHaveAttribute("data-tone", "error");
    expect(systems()[0]).toHaveClass("text-xs");
    await typeAndEnter("hello");
    expect(chatPosts(fetchMock)).toHaveLength(1);
    expect(assistantBubbles()[0]).toHaveTextContent("Hi there.");
  });
});

describe("loading", () => {
  it("shows the loading row and disables Send while the request is in flight", async () => {
    const post = deferred<ChatMessage>();
    await renderPanel({ "POST /api/chat": post.handler });
    expect(screen.queryByTestId("chat-loading")).toBeNull();

    await typeAndEnter("hello");
    const loading = screen.getByTestId("chat-loading");
    expect(loading).toHaveAttribute("role", "status");
    expect(loading).toHaveTextContent("FinAlly is thinking…");
    expect(loading).toHaveClass("text-xs");
    expect(sendButton()).toBeDisabled();

    await act(async () => post.release(messageOf()));
    await act(async () => {});
    expect(screen.queryByTestId("chat-loading")).toBeNull();
    expect(sendButton()).not.toBeDisabled();
  });

  it("a second Enter or Send while pending makes no second POST", async () => {
    const post = deferred<ChatMessage>();
    const fetchMock = await renderPanel({ "POST /api/chat": post.handler });
    await typeAndEnter("first");
    await typeAndEnter("second");
    await act(async () => {
      fireEvent.click(sendButton());
    });
    expect(chatPosts(fetchMock)).toHaveLength(1);
    expect(postedMessage(fetchMock)).toBe("first");

    await act(async () => post.release(messageOf()));
    await act(async () => {});
    expect(chatPosts(fetchMock)).toHaveLength(1);
  });

  it("re-enables Send after an error", async () => {
    await renderPanel({ "POST /api/chat": () => jsonResponse({ error: NOT_CONFIGURED }, 503) });
    await typeAndEnter("hello");
    expect(screen.queryByTestId("chat-loading")).toBeNull();
    expect(sendButton()).not.toBeDisabled();
  });
});

describe("input", () => {
  it("Enter sends and clears the draft; Shift+Enter does not send", async () => {
    const fetchMock = await renderPanel({ "POST /api/chat": messageOf() });
    type("line one");
    await pressEnter({ shiftKey: true });
    expect(chatPosts(fetchMock)).toHaveLength(0);
    expect(input()).toHaveValue("line one");

    await pressEnter();
    expect(chatPosts(fetchMock)).toHaveLength(1);
    expect(input()).toHaveValue("");
  });

  it("Enter during IME composition does not send", async () => {
    const fetchMock = await renderPanel({ "POST /api/chat": messageOf() });
    type("にほんご");
    await pressEnter({ isComposing: true });
    expect(chatPosts(fetchMock)).toHaveLength(0);
    expect(input()).toHaveValue("にほんご");
  });

  it("the Send button submits the draft", async () => {
    const fetchMock = await renderPanel({ "POST /api/chat": messageOf() });
    type("Buy 5 NVDA");
    await act(async () => {
      fireEvent.click(sendButton());
    });
    expect(postedMessage(fetchMock)).toBe("Buy 5 NVDA");
  });

  it("an empty or whitespace-only message makes no request and shows a system bubble", async () => {
    const fetchMock = await renderPanel();
    await typeAndEnter("   ");
    expect(chatPosts(fetchMock)).toHaveLength(0);
    expect(systems()).toHaveLength(1);
    expect(systems()[0]).toHaveTextContent("Message cannot be empty.");
    expect(systems()[0]).toHaveAttribute("data-tone", "error");
  });

  it("an over-long message makes no request and keeps the draft", async () => {
    const fetchMock = await renderPanel();
    const long = "🙂".repeat(2001);
    await typeAndEnter(long);
    expect(chatPosts(fetchMock)).toHaveLength(0);
    expect(systems()[0]).toHaveTextContent("Message is too long (max 2,000 characters).");
    expect(input()).toHaveValue(long);
  });

  it("keeps line breaks and shows markup as literal text", async () => {
    await renderPanel({ "POST /api/chat": messageOf({ content: "<b>x</b>" }) });
    await typeAndEnter("line one\nline two");
    const [user, assistant] = screen.getAllByTestId("chat-message");
    expect(user.textContent).toBe("line one\nline two");
    expect(user.querySelector("p")).toHaveClass("whitespace-pre-wrap");
    expect(assistant.textContent).toBe("<b>x</b>");
    expect(assistant.querySelector("b")).toBeNull();
  });
});

describe("chip", () => {
  it("renders executed trade and watchlist chips", async () => {
    await renderHistory([
      messageOf({
        actions: actionsOf({
          trades: [
            { ticker: "NVDA", side: "buy", quantity: 5, status: "executed", price: 875.2 },
          ],
          watchlist_changes: [
            { ticker: "PYPL", action: "add", status: "executed" },
            { ticker: "PYPL", action: "remove", status: "executed" },
          ],
        }),
      }),
    ]);
    expect(chipTexts()).toEqual(["+ PYPL watchlist", "− PYPL watchlist", "BUY 5 NVDA @ $875.20"]);
    const [add, , trade] = chips();
    expect(add).toHaveAttribute("data-kind", "watchlist");
    expect(add).toHaveAttribute("data-status", "executed");
    expect(trade).toHaveAttribute("data-kind", "trade");
    expect(trade).not.toHaveClass("text-down");
  });

  it("renders a failed chip distinctly with its error", async () => {
    const error = "Insufficient cash (need $12,450.00, have $8,095.00).";
    await renderHistory([
      messageOf({
        actions: actionsOf({
          trades: [{ ticker: "TSLA", side: "buy", quantity: 50, status: "failed", error }],
        }),
      }),
    ]);
    const [chip] = chips();
    expect(chip).toHaveAttribute("data-status", "failed");
    expect(chip).toHaveClass("border-down", "text-down");
    expect(chip.textContent?.startsWith("⚠")).toBe(true);
    expect(chip).toHaveTextContent(error);
    expect(chip).toHaveAttribute("title", error);
  });

  it("executed and failed chips use the text-xs scale", async () => {
    await renderHistory([
      messageOf({
        actions: actionsOf({
          trades: [
            { ticker: "NVDA", side: "buy", quantity: 5, status: "executed", price: 875.2 },
            { ticker: "TSLA", side: "buy", quantity: 50, status: "failed", error: "No cash." },
          ],
        }),
      }),
    ]);
    expect(chips()).toHaveLength(2);
    for (const chip of chips()) expect(chip).toHaveClass("text-xs");
  });

  it("renders null fields as em dashes without throwing", async () => {
    await renderHistory([
      messageOf({
        actions: actionsOf({
          trades: [
            { ticker: null, side: null, quantity: null, status: "failed", error: "Bad trade." },
            { ticker: "AAPL", side: "buy", quantity: 1, status: "executed" },
          ],
          watchlist_changes: [
            { ticker: null, action: null, status: "failed", error: "Bad change." },
          ],
        }),
      }),
    ]);
    expect(chipTexts()).toEqual([
      "⚠ — —: Bad change.",
      "⚠ — — —: Bad trade.",
      "BUY 1 AAPL @ —",
    ]);
  });

  it("renders two actions on the same ticker as two chips", async () => {
    await renderHistory([
      messageOf({
        actions: actionsOf({
          trades: [
            { ticker: "AAPL", side: "buy", quantity: 1, status: "executed", price: 190 },
            { ticker: "AAPL", side: "buy", quantity: 1, status: "executed", price: 190 },
          ],
        }),
      }),
    ]);
    expect(chipTexts()).toEqual(["BUY 1 AAPL @ $190.00", "BUY 1 AAPL @ $190.00"]);
  });

  it("renders no chip row for null actions or two empty lists", async () => {
    await renderHistory([
      messageOf({ id: "a-1", actions: null }),
      messageOf({ id: "a-2", actions: actionsOf() }),
    ]);
    expect(chips()).toHaveLength(0);
    for (const bubble of assistantBubbles()) {
      expect(within(bubble).queryByRole("list")).toBeNull();
    }
  });

  it("orders watchlist changes first, then trades, each in stored order", async () => {
    await renderHistory([
      messageOf({
        actions: actionsOf({
          trades: [
            { ticker: "MSFT", side: "sell", quantity: 2, status: "executed", price: 400 },
            { ticker: "AAPL", side: "buy", quantity: 3, status: "executed", price: 190 },
          ],
          watchlist_changes: [
            { ticker: "PYPL", action: "add", status: "executed" },
            { ticker: "SHOP", action: "add", status: "executed" },
          ],
        }),
      }),
    ]);
    expect(chipTexts()).toEqual([
      "+ PYPL watchlist",
      "+ SHOP watchlist",
      "SELL 2 MSFT @ $400.00",
      "BUY 3 AAPL @ $190.00",
    ]);
  });

  it("formats quantities with up to 4 decimals and prices with 2", async () => {
    await renderHistory([
      messageOf({
        actions: actionsOf({
          trades: [
            { ticker: "AAPL", side: "buy", quantity: 1.23456, status: "executed", price: 190.5 },
            { ticker: "NVDA", side: "buy", quantity: 5, status: "executed", price: 875.2 },
          ],
        }),
      }),
    ]);
    expect(chipTexts()).toEqual(["BUY 1.2346 AAPL @ $190.50", "BUY 5 NVDA @ $875.20"]);
  });
});

describe("bubble", () => {
  const cases: [string, number, string][] = [
    ["503", 503, NOT_CONFIGURED],
    ["502", 502, "The AI assistant failed to respond. Try again."],
    ["400", 400, "Message is too long (max 2,000 characters)."],
  ];

  it.each(cases)("a %s response renders the server text as an error bubble", async (_, status, text) => {
    await renderPanel({ "POST /api/chat": () => jsonResponse({ error: text }, status) });
    await typeAndEnter("hello");
    const [bubble] = systems();
    expect(bubble).toHaveTextContent(text);
    expect(bubble).toHaveAttribute("data-tone", "error");
    expect(bubble).toHaveAttribute("role", "alert");
    const messages = screen.getAllByTestId("chat-message");
    expect(messages).toHaveLength(1);
    expect(messages[0]).toHaveAttribute("data-role", "user");
    expect(messages[0]).toHaveTextContent("hello");
  });

  it("a network failure renders the generic message as an error bubble", async () => {
    await renderPanel({
      "POST /api/chat": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await typeAndEnter("hello");
    const [bubble] = systems();
    expect(bubble).toHaveTextContent("Could not reach the server. Try again.");
    expect(bubble).toHaveAttribute("data-tone", "error");
    expect(bubble).toHaveAttribute("role", "alert");
    expect(screen.getAllByTestId("chat-message")[0]).toHaveTextContent("hello");
  });
});

describe("prompt", () => {
  it("shows the three starter prompts in an empty chat", async () => {
    expect(PROMPTS).toEqual(["Analyze my portfolio", "Buy 5 NVDA", "Add PYPL to my watchlist"]);
    await renderPanel();
    const prompts = screen.getAllByTestId("chat-prompt");
    expect(prompts.map((p) => p.textContent)).toEqual([...PROMPTS]);
    for (const p of prompts) expect(p).toHaveAttribute("type", "button");
    for (const p of prompts) expect(p).toHaveClass("text-xs");
  });

  it("hides the prompts when the history has messages", async () => {
    await renderHistory([messageOf({ id: "h-1", role: "user", content: "hi" })]);
    expect(screen.queryAllByTestId("chat-prompt")).toHaveLength(0);
  });

  it("clicking a prompt posts exactly its label and the prompts disappear", async () => {
    const post = deferred<ChatMessage>();
    const fetchMock = await renderPanel({ "POST /api/chat": post.handler });
    await act(async () => {
      fireEvent.click(screen.getAllByTestId("chat-prompt")[1]);
    });
    expect(chatPosts(fetchMock)).toHaveLength(1);
    expect(postedMessage(fetchMock)).toBe("Buy 5 NVDA");
    expect(screen.queryAllByTestId("chat-prompt")).toHaveLength(0);

    await act(async () => post.release(messageOf()));
    await act(async () => {});
    expect(screen.queryAllByTestId("chat-prompt")).toHaveLength(0);
  });

  it("hides the prompts while a request is pending even with no entries", async () => {
    await renderPanel();
    act(() => useChat.setState({ pending: true }));
    expect(screen.queryAllByTestId("chat-prompt")).toHaveLength(0);
  });
});

describe("reset in flight", () => {
  it("disables Send, hides the prompts and keeps the draft unsent until the reset ends", async () => {
    const fetchMock = await renderPanel({ "POST /api/chat": messageOf() });
    act(() => usePortfolio.setState({ resetting: true }));

    expect(sendButton()).toBeDisabled();
    expect(sendButton()).toHaveAttribute("title", "Wait for the reset to finish");
    expect(screen.queryAllByTestId("chat-prompt")).toHaveLength(0);
    await typeAndEnter("buy");
    expect(chatPosts(fetchMock)).toHaveLength(0);
    expect(input().value).toBe("buy");

    act(() => usePortfolio.setState({ resetting: false }));
    expect(sendButton()).not.toBeDisabled();
    expect(screen.getAllByTestId("chat-prompt")).toHaveLength(PROMPTS.length);
    await pressEnter();
    expect(chatPosts(fetchMock)).toHaveLength(1);
  });
});

describe("refetch", () => {
  const REFETCH_PATHS = ["/api/portfolio", "/api/trades", "/api/portfolio/history", "/api/watchlist"];

  const counts = (fetchMock: ReturnType<typeof stubApi>) =>
    REFETCH_PATHS.map((path) => callsTo(fetchMock, path).length);

  it("a reply with actions refreshes the portfolio and the watchlist exactly once", async () => {
    const fetchMock = await renderPanel({
      "POST /api/chat": messageOf({
        actions: actionsOf({
          trades: [{ ticker: "AAPL", side: "buy", quantity: 1, status: "executed", price: 190 }],
        }),
      }),
    });
    expect(counts(fetchMock)).toEqual([0, 0, 0, 0]);
    await typeAndEnter("buy");
    expect(counts(fetchMock)).toEqual([1, 1, 1, 1]);
  });

  it("non-null actions with only failures still refresh once", async () => {
    const fetchMock = await renderPanel({
      "POST /api/chat": messageOf({
        actions: actionsOf({
          trades: [{ ticker: "AAPL", side: "sell", quantity: 1, status: "failed", error: "No." }],
        }),
      }),
    });
    await typeAndEnter("sell");
    expect(counts(fetchMock)).toEqual([1, 1, 1, 1]);
  });

  it("a reply with null actions refreshes nothing", async () => {
    const fetchMock = await renderPanel({ "POST /api/chat": messageOf({ actions: null }) });
    await typeAndEnter("hello");
    expect(counts(fetchMock)).toEqual([0, 0, 0, 0]);
  });

  it("a 500 refreshes once: the server may have run actions before failing", async () => {
    const fetchMock = await renderPanel({
      "POST /api/chat": () => new Response("Internal Server Error", { status: 500 }),
    });
    await typeAndEnter("buy");
    expect(systems()).toHaveLength(1);
    expect(counts(fetchMock)).toEqual([1, 1, 1, 1]);
  });

  it("a 400 refreshes nothing: the server rejected the message before any write", async () => {
    const fetchMock = await renderPanel({
      "POST /api/chat": () => jsonResponse({ error: "Message cannot be empty." }, 400),
    });
    await typeAndEnter("buy");
    expect(counts(fetchMock)).toEqual([0, 0, 0, 0]);
  });

  it("each reply with actions triggers its own refresh", async () => {
    const fetchMock = await renderPanel({
      "POST /api/chat": () =>
        messageOf({
          id: `m-${Math.random()}`,
          actions: actionsOf({
            watchlist_changes: [{ ticker: "PYPL", action: "add", status: "executed" }],
          }),
        }),
    });
    await typeAndEnter("add PYPL");
    await typeAndEnter("add PYPL");
    expect(counts(fetchMock)).toEqual([2, 2, 2, 2]);
  });
});

describe("scroll", () => {
  it("scrolls the list to the newest entry after a reply", async () => {
    const post = deferred<ChatMessage>();
    await renderPanel({ "POST /api/chat": post.handler });
    const list = screen.getByTestId("chat-list");
    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 480 });
    list.scrollTop = 0;

    await typeAndEnter("hello");
    expect(list.scrollTop).toBe(480);

    Object.defineProperty(list, "scrollHeight", { configurable: true, value: 960 });
    await act(async () => post.release(messageOf()));
    await act(async () => {});
    expect(list.scrollTop).toBe(960);
  });
});

describe("collapse", () => {
  it("chat-toggle hides and shows the list and the input", async () => {
    await renderPanel();
    const toggle = screen.getByTestId("chat-toggle");
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(toggle).toHaveAttribute("aria-label", "Collapse AI chat");

    fireEvent.click(toggle);
    expect(screen.getByTestId("chat-toggle")).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByTestId("chat-toggle")).toHaveAttribute("aria-label", "Expand AI chat");
    expect(screen.getByTestId("panel-chat")).toBeInTheDocument();
    expect(screen.queryByTestId("chat-list")).toBeNull();
    expect(screen.queryByTestId("chat-input")).toBeNull();
    expect(useChat.getState().collapsed).toBe(true);

    fireEvent.click(screen.getByTestId("chat-toggle"));
    expect(screen.getByTestId("chat-toggle")).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByTestId("chat-list")).toBeInTheDocument();
    expect(screen.getByTestId("chat-input")).toBeInTheDocument();
  });

  it("the toggle has a 24px minimum box when expanded and collapsed", async () => {
    await renderPanel();
    expect(screen.getByTestId("chat-toggle")).toHaveClass("h-6", "min-w-6", "-my-1");
    fireEvent.click(screen.getByTestId("chat-toggle"));
    const toggle = screen.getByTestId("chat-toggle");
    expect(toggle).toHaveClass("h-6", "min-w-6", "xl:my-0");
    expect(toggle).toHaveAttribute("type", "button");
    expect(toggle).toHaveAttribute("aria-controls");
  });

  it("the heading is visible vertical text on the collapsed xl rail", async () => {
    await renderPanel();
    const expanded = screen.getByTestId("chat-title");
    expect(expanded).toHaveTextContent("AI Chat");
    expect(expanded).not.toHaveClass("xl:[writing-mode:vertical-rl]");
    expect(expanded).not.toHaveClass("xl:sr-only");

    fireEvent.click(screen.getByTestId("chat-toggle"));
    const collapsed = screen.getByTestId("chat-title");
    expect(collapsed).toHaveTextContent("AI Chat");
    expect(collapsed).toHaveClass("xl:[writing-mode:vertical-rl]", "xl:order-last");
    expect(collapsed).not.toHaveClass("xl:sr-only");
  });

  it("aria-controls points at the panel body", async () => {
    await renderPanel();
    const id = screen.getByTestId("chat-toggle").getAttribute("aria-controls");
    expect(id).toBeTruthy();
    expect(document.getElementById(String(id))).toContainElement(screen.getByTestId("chat-list"));
  });
});
