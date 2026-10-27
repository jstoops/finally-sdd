// Test double for the browser EventSource. Tests drive it with emitOpen / emitMessage /
// emitError and inspect FakeEventSource.instances.

type Handler<E> = ((event: E) => void) | null;

export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;

  /** Every instance created since the last reset, oldest first. */
  static instances: FakeEventSource[] = [];

  static reset(): void {
    FakeEventSource.instances = [];
  }

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;

  readonly url: string;
  readyState: number = FakeEventSource.CONNECTING;
  closed = false;
  onopen: Handler<Event> = null;
  onmessage: Handler<MessageEvent<string>> = null;
  onerror: Handler<Event> = null;

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  close(): void {
    this.readyState = FakeEventSource.CLOSED;
    this.closed = true;
  }

  emitOpen(): void {
    this.readyState = FakeEventSource.OPEN;
    this.onopen?.(new Event("open"));
  }

  /** Deliver one SSE `data:` payload; objects are JSON-encoded, strings are sent as-is. */
  emitMessage(data: unknown): void {
    const payload = typeof data === "string" ? data : JSON.stringify(data);
    this.onmessage?.(new MessageEvent("message", { data: payload }));
  }

  /** Set readyState (CONNECTING = browser retrying, CLOSED = given up), then fire onerror. */
  emitError(readyState: number): void {
    this.readyState = readyState;
    this.onerror?.(new Event("error"));
  }

  /** Instances that have not been closed. */
  static open(): FakeEventSource[] {
    return FakeEventSource.instances.filter((es) => !es.closed);
  }

  /** The most recently created instance. */
  static latest(): FakeEventSource {
    const last = FakeEventSource.instances[FakeEventSource.instances.length - 1];
    if (!last) throw new Error("No FakeEventSource has been created");
    return last;
  }
}
