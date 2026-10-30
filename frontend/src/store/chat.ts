// AI chat state (AI-01, AI-11 to AI-14): the conversation entries, the one in-flight send, the
// history reload and the panel's collapsed flag. `send` checks the text locally, shows it at
// once, posts it to /api/chat and appends the stored assistant reply, or an error entry with
// the server's text. It resolves the reply to the caller, so the component (not this store)
// refreshes other stores after actions: the stores never import each other.
import { create } from "zustand";

import { ApiError, apiFetch } from "@/api/client";
import type { ChatHistoryResponse, ChatMessage, ChatRequest } from "@/api/types";

const NETWORK_ERROR = "Could not reach the server. Try again.";
const HISTORY_ERROR = "Could not load the chat history.";

/** Longest message the server accepts, counted in code points after trimming. */
export const MAX_MESSAGE_CHARS = 2000;

const EMPTY_MESSAGE = "Message cannot be empty.";
const TOO_LONG_MESSAGE = "Message is too long (max 2,000 characters).";

/**
 * The server's 400 text for a message it would reject, or null when it is sendable. Counts
 * code points (Array.from), not UTF-16 units, so 2,000 emoji pass like 2,000 letters.
 */
export function validateChatMessage(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed === "") return EMPTY_MESSAGE;
  if (Array.from(trimmed).length > MAX_MESSAGE_CHARS) return TOO_LONG_MESSAGE;
  return null;
}

/** The server's `error` text for an API failure, or the generic network message. */
function failureMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : NETWORK_ERROR;
}

/** True for a body shaped like GET /api/chat/history. */
function isChatHistory(body: unknown): body is ChatHistoryResponse {
  return (
    !!body &&
    typeof body === "object" &&
    Array.isArray((body as { messages?: unknown }).messages)
  );
}

/** A stored message, or a local system line (an error or a note) that the server never saw. */
export type ChatEntry =
  | { kind: "message"; message: ChatMessage }
  | { kind: "system"; id: string; text: string; tone: "error" | "info" };

let localId = 0;

function nextLocalId(): string {
  localId += 1;
  return `local-${localId}`;
}

function errorEntry(text: string): ChatEntry {
  return { kind: "system", id: nextLocalId(), text, tone: "error" };
}

// History guard (Pitfall 9). A history load takes a number when it starts and applies only if
// it is still the newest; a send or a clear bumps the number, so a load that was in flight
// across either is discarded and never overwrites the newer entries.
let sequence = 0;

function bump(): number {
  sequence += 1;
  return sequence;
}

// Clear epoch: a reply that arrives after the chat was cleared (a reset) is dropped.
let clears = 0;

interface ChatState {
  /** The conversation in display order, oldest first. */
  entries: ChatEntry[];
  /** True while a POST /api/chat is in flight; a second send is ignored meanwhile. */
  pending: boolean;
  /** True once a GET /api/chat/history has been applied. */
  loaded: boolean;
  /**
   * True once the newest history load has settled (applied or failed), or after a clear. The
   * panel blocks sends and hides the starter prompts until then: a send bumps the history
   * guard, so a send that raced the first load would discard the stored conversation.
   */
  settled: boolean;
  /** True when the panel is folded to its header (UX-02). */
  collapsed: boolean;
  /** GET /api/chat/history: replaces the entries unless a send or a clear happened since. */
  loadHistory: () => Promise<void>;
  /**
   * Send `text` (trimmed). Resolves the assistant reply, or null when nothing was sent (a
   * send already in flight, or the local check failed: an error entry is appended) or the
   * request failed (an error entry is appended).
   */
  send: (text: string) => Promise<ChatMessage | null>;
  /** Empty the conversation locally (after a reset the server has none either). */
  clear: () => void;
  toggleCollapsed: () => void;
}

export const useChat = create<ChatState>()((set, get) => ({
  entries: [],
  pending: false,
  loaded: false,
  settled: false,
  collapsed: false,

  loadHistory: async () => {
    const seq = bump();
    let body: unknown;
    try {
      body = await apiFetch<unknown>("/api/chat/history");
    } catch (err) {
      if (seq === sequence) {
        set((s) => ({ entries: [...s.entries, errorEntry(failureMessage(err))], settled: true }));
      }
      return;
    }
    if (seq !== sequence) return;
    if (!isChatHistory(body)) {
      set((s) => ({ entries: [...s.entries, errorEntry(HISTORY_ERROR)], settled: true }));
      return;
    }
    set({
      entries: body.messages.map((message) => ({ kind: "message", message })),
      loaded: true,
      settled: true,
    });
  },

  send: async (text) => {
    if (get().pending) return null;
    const invalid = validateChatMessage(text);
    if (invalid !== null) {
      bump();
      set((s) => ({ entries: [...s.entries, errorEntry(invalid)] }));
      return null;
    }
    const content = text.trim();
    const optimistic: ChatMessage = {
      id: nextLocalId(),
      role: "user",
      content,
      actions: null,
      created_at: "",
    };
    bump();
    const epoch = clears;
    set((s) => ({
      entries: [...s.entries, { kind: "message", message: optimistic }],
      pending: true,
    }));
    try {
      const body: ChatRequest = { message: content };
      const reply = await apiFetch<ChatMessage>("/api/chat", {
        method: "POST",
        body: JSON.stringify(body),
      });
      if (epoch === clears) {
        set((s) => ({ entries: [...s.entries, { kind: "message", message: reply }] }));
      }
      return reply;
    } catch (err) {
      if (epoch === clears) {
        set((s) => ({ entries: [...s.entries, errorEntry(failureMessage(err))] }));
      }
      return null;
    } finally {
      set({ pending: false });
    }
  },

  clear: () => {
    bump();
    clears += 1;
    // The server has no messages after a reset, so a discarded first load blocks nothing.
    set({ entries: [], settled: true });
  },

  toggleCollapsed: () => set((s) => ({ collapsed: !s.collapsed })),
}));
