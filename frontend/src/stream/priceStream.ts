// Reconnecting price stream (MD-04, G-01). The app's only `new EventSource`.
//
// Status machine: connecting (yellow) -> open (green). An error while the browser is
// still CONNECTING means it is retrying on its own (server sent `retry: 1000`), so we
// report "connecting" for a short blip. A server that is down (connection refused) keeps
// the browser in CONNECTING forever, so after DISCONNECTED_AFTER_FAILURES consecutive
// failed attempts with no successful open we report "closed" (red) while the browser
// keeps retrying; the next open turns it green again. Once readyState is CLOSED the
// browser never retries, so we report "closed" at once and recreate the EventSource
// after a capped backoff.
import type { PriceFrame, StreamStatus } from "@/api/types";

/** Waits before recreating a CLOSED stream: 1s, 2s, then 5s for every later attempt. */
export const BACKOFF_MS: readonly number[] = [1000, 2000, 5000];

/**
 * Consecutive failed connection attempts (errors with no open in between) after which
 * the stream counts as disconnected (red). With `retry: 1000` this is about 3 seconds.
 */
export const DISCONNECTED_AFTER_FAILURES = 3;

/** EventSource.CLOSED, as a literal so this module never needs the global at load time. */
const ES_CLOSED = 2;

export interface PriceStreamOptions {
  url: string;
  onFrame: (frame: PriceFrame) => void;
  onStatus: (status: StreamStatus) => void;
}

/**
 * Open the price stream and keep it alive. Returns a cleanup that cancels any pending
 * retry and closes the current connection. Call only from an effect.
 */
export function connectPriceStream(
  opts: PriceStreamOptions,
  makeEventSource: (url: string) => EventSource = (u) => new EventSource(u),
): () => void {
  let es: EventSource | null = null;
  let attempt = 0;
  let failures = 0; // consecutive errors since the last successful open
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const open = () => {
    timer = null;
    if (stopped) return;
    // A long outage stays red across recreated instances instead of flickering yellow.
    opts.onStatus(failures >= DISCONNECTED_AFTER_FAILURES ? "closed" : "connecting");
    const source = makeEventSource(opts.url);
    es = source;
    source.onopen = () => {
      attempt = 0;
      failures = 0;
      opts.onStatus("open");
    };
    source.onmessage = (event: MessageEvent<string>) => {
      let frame: PriceFrame;
      try {
        frame = JSON.parse(event.data) as PriceFrame;
      } catch {
        return; // Malformed frame: drop it; the next one replaces the map.
      }
      if (frame && typeof frame === "object") opts.onFrame(frame);
    };
    source.onerror = () => {
      failures += 1;
      if (source.readyState !== ES_CLOSED) {
        // The browser retries on its own; only the reported status changes.
        opts.onStatus(failures >= DISCONNECTED_AFTER_FAILURES ? "closed" : "connecting");
        return;
      }
      opts.onStatus("closed");
      source.close();
      if (es === source) es = null;
      if (stopped) return;
      const delay = BACKOFF_MS[Math.min(attempt, BACKOFF_MS.length - 1)];
      attempt += 1;
      timer = setTimeout(open, delay);
    };
  };

  open();

  return () => {
    stopped = true;
    if (timer !== null) clearTimeout(timer);
    timer = null;
    es?.close();
    es = null;
  };
}
