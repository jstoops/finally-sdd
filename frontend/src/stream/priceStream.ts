// Reconnecting price stream (MD-04, G-01). The app's only `new EventSource`.
//
// Status machine: connecting (yellow) -> open (green). An error while the browser is
// still CONNECTING means it is retrying on its own (server sent `retry: 1000`), so we
// only report "connecting". Once readyState is CLOSED the browser never retries, so we
// report "closed" (red) and recreate the EventSource after a capped backoff.
import type { PriceFrame, StreamStatus } from "@/api/types";

/** Waits before recreating a CLOSED stream: 1s, 2s, then 5s for every later attempt. */
export const BACKOFF_MS: readonly number[] = [1000, 2000, 5000];

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
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;

  const open = () => {
    timer = null;
    if (stopped) return;
    opts.onStatus("connecting");
    const source = makeEventSource(opts.url);
    es = source;
    source.onopen = () => {
      attempt = 0;
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
      if (source.readyState !== ES_CLOSED) {
        opts.onStatus("connecting");
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
