// AI chat state (AI-01, AI-13): the conversation entries and the one in-flight send. `send`
// shows the user's text at once, posts it to /api/chat and appends the stored assistant
// reply, or an error entry with the server's text. It resolves the reply to the caller, so
// the component (not this store) refreshes other stores after actions: the stores never
// import each other.
import { create } from "zustand";

import { ApiError, apiFetch } from "@/api/client";
import type { ChatMessage, ChatRequest } from "@/api/types";

const NETWORK_ERROR = "Could not reach the server. Try again.";

/** The server's `error` text for an API failure, or the generic network message. */
function failureMessage(err: unknown): string {
  return err instanceof ApiError ? err.message : NETWORK_ERROR;
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

interface ChatState {
  /** The conversation in display order, oldest first. */
  entries: ChatEntry[];
  /** True while a POST /api/chat is in flight; a second send is ignored meanwhile. */
  pending: boolean;
  /**
   * Send `text`. Resolves the assistant reply, or null when nothing was sent (empty text or
   * a send already in flight) or the request failed (an error entry is appended instead).
   */
  send: (text: string) => Promise<ChatMessage | null>;
}

export const useChat = create<ChatState>()((set, get) => ({
  entries: [],
  pending: false,

  send: async (text) => {
    if (get().pending || text.trim() === "") return null;
    const optimistic: ChatMessage = {
      id: nextLocalId(),
      role: "user",
      content: text,
      actions: null,
      created_at: "",
    };
    set((s) => ({
      entries: [...s.entries, { kind: "message", message: optimistic }],
      pending: true,
    }));
    try {
      const body: ChatRequest = { message: text };
      const reply = await apiFetch<ChatMessage>("/api/chat", {
        method: "POST",
        body: JSON.stringify(body),
      });
      set((s) => ({ entries: [...s.entries, { kind: "message", message: reply }] }));
      return reply;
    } catch (err) {
      const entry: ChatEntry = {
        kind: "system",
        id: nextLocalId(),
        text: failureMessage(err),
        tone: "error",
      };
      set((s) => ({ entries: [...s.entries, entry] }));
      return null;
    } finally {
      set({ pending: false });
    }
  },
}));
