import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ChatHistoryResponse, ChatMessage } from "@/api/types";
import { MAX_MESSAGE_CHARS, useChat, validateChatMessage } from "@/store/chat";
import { callsTo, jsonResponse, stubApi } from "@/test/stubFetch";

const EMPTY = "Message cannot be empty.";
const TOO_LONG = "Message is too long (max 2,000 characters).";

function messageOf(overrides: Partial<ChatMessage> = {}): ChatMessage {
  return {
    id: "m-1",
    role: "assistant",
    content: "Hello! I'm FinAlly, your AI trading assistant. How can I help?",
    actions: null,
    created_at: "2026-10-09T14:03:22Z",
    ...overrides,
  };
}

const HISTORY: ChatMessage[] = [
  messageOf({ id: "h-1", role: "user", content: "buy" }),
  messageOf({
    id: "h-2",
    content: "Buying 1 share of AAPL.",
    actions: {
      trades: [{ ticker: "AAPL", side: "buy", quantity: 1, status: "executed", price: 190.52 }],
      watchlist_changes: [],
    },
  }),
];

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

const messageIds = () =>
  useChat
    .getState()
    .entries.map((e) => (e.kind === "message" ? e.message.id : `system:${e.text}`));

beforeEach(() => {
  useChat.setState({ entries: [], pending: false, loaded: false, settled: false, collapsed: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("validateChatMessage", () => {
  it("rejects empty and whitespace-only text", () => {
    expect(validateChatMessage("")).toBe(EMPTY);
    expect(validateChatMessage("   \n\t ")).toBe(EMPTY);
  });

  it("counts code points on the trimmed text: 2,000 emoji pass, 2,001 fail", () => {
    expect(MAX_MESSAGE_CHARS).toBe(2000);
    expect(validateChatMessage("🙂".repeat(2000))).toBeNull();
    expect(validateChatMessage(`  ${"🙂".repeat(2000)}  `)).toBeNull();
    expect(validateChatMessage("🙂".repeat(2001))).toBe(TOO_LONG);
    expect(validateChatMessage("a".repeat(2001))).toBe(TOO_LONG);
  });

  it("accepts ordinary text", () => {
    expect(validateChatMessage("Buy 5 NVDA")).toBeNull();
  });
});

describe("useChat send", () => {
  it("rejects an empty message with a system entry and no request", async () => {
    const fetchMock = stubApi();
    await expect(useChat.getState().send("   ")).resolves.toEqual({ kind: "skipped" });
    expect(callsTo(fetchMock, "/api/chat", "POST")).toHaveLength(0);
    const [entry] = useChat.getState().entries;
    expect(entry).toMatchObject({ kind: "system", tone: "error", text: EMPTY });
  });

  it("rejects an over-long message before any request", async () => {
    const fetchMock = stubApi();
    await useChat.getState().send("🙂".repeat(2001));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(useChat.getState().entries[0]).toMatchObject({ kind: "system", text: TOO_LONG });
  });

  it("posts the trimmed text and appends the optimistic message and the reply", async () => {
    const reply = messageOf({ id: "m-2" });
    const fetchMock = stubApi({ "POST /api/chat": reply });
    await expect(useChat.getState().send("  hello\nthere  ")).resolves.toEqual({
      kind: "reply",
      reply,
    });
    const [call] = callsTo(fetchMock, "/api/chat", "POST");
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({
      message: "hello\nthere",
    });
    const entries = useChat.getState().entries;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({
      kind: "message",
      message: { role: "user", content: "hello\nthere" },
    });
    expect(entries[1]).toEqual({ kind: "message", message: reply });
    expect(useChat.getState().pending).toBe(false);
  });

  it("skips with no request while another send is pending", async () => {
    const post = deferred<ChatMessage>();
    const fetchMock = stubApi({ "POST /api/chat": post.handler });
    const first = useChat.getState().send("one");
    expect(useChat.getState().pending).toBe(true);
    await expect(useChat.getState().send("two")).resolves.toEqual({ kind: "skipped" });
    expect(callsTo(fetchMock, "/api/chat", "POST")).toHaveLength(1);
    post.release(messageOf({ id: "m-2" }));
    await first;
    expect(useChat.getState().pending).toBe(false);
  });

  it("turns an ApiError into an error system entry with the server text", async () => {
    stubApi({
      "POST /api/chat": () =>
        jsonResponse({ error: "The AI assistant failed to respond. Try again." }, 502),
    });
    await expect(useChat.getState().send("hi")).resolves.toEqual({
      kind: "failed",
      mayHaveActed: true,
    });
    const entries = useChat.getState().entries;
    expect(entries).toHaveLength(2);
    expect(entries[1]).toMatchObject({
      kind: "system",
      tone: "error",
      text: "The AI assistant failed to respond. Try again.",
    });
  });

  it("a 5xx or a network failure may have acted; a 4xx did not", async () => {
    stubApi({ "POST /api/chat": () => jsonResponse({ error: "Bad." }, 400) });
    await expect(useChat.getState().send("hi")).resolves.toEqual({
      kind: "failed",
      mayHaveActed: false,
    });
    stubApi({ "POST /api/chat": () => new Response("Internal Server Error", { status: 500 }) });
    await expect(useChat.getState().send("hi")).resolves.toEqual({
      kind: "failed",
      mayHaveActed: true,
    });
    stubApi({
      "POST /api/chat": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await expect(useChat.getState().send("hi")).resolves.toEqual({
      kind: "failed",
      mayHaveActed: true,
    });
  });
});

describe("useChat loadHistory", () => {
  it("replaces the entries with the server messages and marks the chat loaded", async () => {
    const fetchMock = stubApi({ "GET /api/chat/history": { messages: HISTORY } });
    await useChat.getState().loadHistory();
    expect(callsTo(fetchMock, "/api/chat/history")).toHaveLength(1);
    expect(messageIds()).toEqual(["h-1", "h-2"]);
    expect(useChat.getState().loaded).toBe(true);
    expect(useChat.getState().settled).toBe(true);
  });

  it("is not settled while the first load is in flight", async () => {
    const history = deferred<ChatHistoryResponse>();
    stubApi({ "GET /api/chat/history": history.handler });
    const load = useChat.getState().loadHistory();
    expect(useChat.getState().settled).toBe(false);
    history.release({ messages: HISTORY });
    await load;
    expect(useChat.getState().settled).toBe(true);
  });

  it("is idempotent: loading twice leaves the server messages once", async () => {
    stubApi({ "GET /api/chat/history": { messages: HISTORY } });
    await useChat.getState().loadHistory();
    await useChat.getState().loadHistory();
    expect(messageIds()).toEqual(["h-1", "h-2"]);
  });

  it("discards a history response that resolves after a send started", async () => {
    const history = deferred<ChatHistoryResponse>();
    const reply = messageOf({ id: "m-2" });
    stubApi({ "GET /api/chat/history": history.handler, "POST /api/chat": reply });
    const load = useChat.getState().loadHistory();
    await useChat.getState().send("buy");
    history.release({ messages: HISTORY });
    await load;
    const entries = useChat.getState().entries;
    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ kind: "message", message: { content: "buy" } });
    expect(entries[1]).toEqual({ kind: "message", message: reply });
  });

  it("discards a history response that resolves after a clear", async () => {
    const history = deferred<ChatHistoryResponse>();
    stubApi({ "GET /api/chat/history": history.handler });
    const load = useChat.getState().loadHistory();
    useChat.getState().clear();
    expect(useChat.getState().settled).toBe(true);
    history.release({ messages: HISTORY });
    await load;
    expect(useChat.getState().entries).toEqual([]);
  });

  it("shows one error entry when the history cannot be loaded", async () => {
    stubApi({ "GET /api/chat/history": () => jsonResponse({ error: "Database busy" }, 500) });
    await useChat.getState().loadHistory();
    const entries = useChat.getState().entries;
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ kind: "system", tone: "error", text: "Database busy" });
    // A failed load still settles, so the panel does not block sends forever.
    expect(useChat.getState().settled).toBe(true);
  });

  it("shows the network message when the server cannot be reached", async () => {
    stubApi({
      "GET /api/chat/history": () => {
        throw new TypeError("Failed to fetch");
      },
    });
    await useChat.getState().loadHistory();
    expect(useChat.getState().entries[0]).toMatchObject({
      kind: "system",
      text: "Could not reach the server. Try again.",
    });
  });

  it("rejects a body that is not a chat history", async () => {
    stubApi({ "GET /api/chat/history": { tickers: [] } });
    await useChat.getState().loadHistory();
    expect(useChat.getState().loaded).toBe(false);
    expect(useChat.getState().settled).toBe(true);
    expect(useChat.getState().entries).toHaveLength(1);
    expect(useChat.getState().entries[0]).toMatchObject({ kind: "system", tone: "error" });
  });
});

describe("useChat clear and collapse", () => {
  it("clear empties the entries", async () => {
    stubApi({ "GET /api/chat/history": { messages: HISTORY } });
    await useChat.getState().loadHistory();
    useChat.getState().clear();
    expect(useChat.getState().entries).toEqual([]);
  });

  it("toggleCollapsed flips collapsed", () => {
    expect(useChat.getState().collapsed).toBe(false);
    useChat.getState().toggleCollapsed();
    expect(useChat.getState().collapsed).toBe(true);
    useChat.getState().toggleCollapsed();
    expect(useChat.getState().collapsed).toBe(false);
  });
});
