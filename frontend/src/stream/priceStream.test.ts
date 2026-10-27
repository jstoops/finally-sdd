import { beforeEach, describe, expect, it, vi } from "vitest";

import type { PriceFrame, StreamStatus } from "@/api/types";
import {
  BACKOFF_MS,
  connectPriceStream,
  DISCONNECTED_AFTER_FAILURES,
} from "@/stream/priceStream";
import { FakeEventSource } from "@/test/FakeEventSource";

const URL = "/api/stream/prices";

function setup() {
  const statuses: StreamStatus[] = [];
  const frames: PriceFrame[] = [];
  const stop = connectPriceStream(
    { url: URL, onFrame: (f) => frames.push(f), onStatus: (s) => statuses.push(s) },
    (u) => new FakeEventSource(u) as unknown as EventSource,
  );
  return { statuses, frames, stop };
}

/** Drive the current instance to CLOSED. */
function closeLatest() {
  FakeEventSource.latest().emitError(FakeEventSource.CLOSED);
}

describe("connectPriceStream", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("exports the capped backoff schedule", () => {
    expect(BACKOFF_MS).toEqual([1000, 2000, 5000]);
  });

  it("reports connecting on create and open once the stream opens", () => {
    const { statuses } = setup();
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.latest().url).toBe(URL);
    expect(statuses).toEqual(["connecting"]);
    FakeEventSource.latest().emitOpen();
    expect(statuses).toEqual(["connecting", "open"]);
  });

  it("an error while CONNECTING reports connecting and leaves the browser to retry", () => {
    const { statuses } = setup();
    FakeEventSource.latest().emitOpen();
    FakeEventSource.latest().emitError(FakeEventSource.CONNECTING);
    expect(statuses.at(-1)).toBe("connecting");
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(FakeEventSource.latest().closed).toBe(false);
  });

  it("reports closed after repeated failed retries while the browser keeps retrying", () => {
    // WR-03: a stopped server leaves readyState in CONNECTING forever.
    expect(DISCONNECTED_AFTER_FAILURES).toBe(3);
    const { statuses } = setup();
    const es = FakeEventSource.latest();
    es.emitOpen();
    es.emitError(FakeEventSource.CONNECTING);
    es.emitError(FakeEventSource.CONNECTING);
    expect(statuses.at(-1)).toBe("connecting");
    es.emitError(FakeEventSource.CONNECTING);
    expect(statuses.at(-1)).toBe("closed");
    es.emitError(FakeEventSource.CONNECTING);
    expect(statuses.at(-1)).toBe("closed");
    // The browser is still retrying: no recreation, no close.
    expect(FakeEventSource.instances).toHaveLength(1);
    expect(es.closed).toBe(false);
    // The server comes back: the next open turns it green and resets the count.
    es.emitOpen();
    expect(statuses.at(-1)).toBe("open");
    es.emitError(FakeEventSource.CONNECTING);
    expect(statuses.at(-1)).toBe("connecting");
  });

  it("counts failures from the first connect, before any open", () => {
    const { statuses } = setup();
    for (let i = 0; i < DISCONNECTED_AFTER_FAILURES; i += 1) {
      FakeEventSource.latest().emitError(FakeEventSource.CONNECTING);
    }
    expect(statuses.at(-1)).toBe("closed");
  });

  it("a long outage stays closed across recreated instances", () => {
    const { statuses } = setup();
    for (let i = 0; i < DISCONNECTED_AFTER_FAILURES; i += 1) {
      FakeEventSource.latest().emitError(FakeEventSource.CONNECTING);
    }
    closeLatest();
    vi.advanceTimersByTime(BACKOFF_MS[0]);
    expect(FakeEventSource.instances).toHaveLength(2);
    expect(statuses.at(-1)).toBe("closed");
    FakeEventSource.latest().emitOpen();
    expect(statuses.at(-1)).toBe("open");
  });

  it("an error with readyState CLOSED reports closed and closes the old instance", () => {
    const { statuses } = setup();
    const first = FakeEventSource.latest();
    closeLatest();
    expect(statuses.at(-1)).toBe("closed");
    expect(first.closed).toBe(true);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("retries after 1000, 2000, 5000 and then 5000 ms (capped)", () => {
    setup();
    const expected = [1000, 2000, 5000, 5000];
    for (const [i, delay] of expected.entries()) {
      closeLatest();
      expect(FakeEventSource.instances).toHaveLength(i + 1);
      vi.advanceTimersByTime(delay - 1);
      expect(FakeEventSource.instances).toHaveLength(i + 1);
      vi.advanceTimersByTime(1);
      expect(FakeEventSource.instances).toHaveLength(i + 2);
    }
  });

  it("a successful open resets the next wait to 1000 ms", () => {
    const { statuses } = setup();
    closeLatest();
    vi.advanceTimersByTime(1000);
    closeLatest();
    vi.advanceTimersByTime(2000);
    expect(FakeEventSource.instances).toHaveLength(3);
    FakeEventSource.latest().emitOpen();
    expect(statuses.at(-1)).toBe("open");
    closeLatest();
    vi.advanceTimersByTime(999);
    expect(FakeEventSource.instances).toHaveLength(3);
    vi.advanceTimersByTime(1);
    expect(FakeEventSource.instances).toHaveLength(4);
    expect(statuses.at(-1)).toBe("connecting");
  });

  it("cleanup during a pending retry cancels it and creates no orphan instance", () => {
    const { stop } = setup();
    closeLatest();
    stop();
    vi.advanceTimersByTime(60_000);
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("cleanup closes the current instance", () => {
    const { stop } = setup();
    const es = FakeEventSource.latest();
    es.emitOpen();
    stop();
    expect(es.closed).toBe(true);
  });

  it("passes parsed JSON frames to onFrame", () => {
    const { frames } = setup();
    const frame = {
      AAPL: {
        ticker: "AAPL",
        price: 190.52,
        previous_price: 190.41,
        open_price: 190,
        timestamp: 1760000000.123,
        change: 0.11,
        change_percent: 0.0578,
        direction: "up",
      },
    };
    FakeEventSource.latest().emitMessage(frame);
    expect(frames).toEqual([frame]);
  });

  it("ignores a malformed frame without throwing", () => {
    const { frames, statuses } = setup();
    const before = [...statuses];
    expect(() => FakeEventSource.latest().emitMessage("{not json")).not.toThrow();
    expect(frames).toHaveLength(0);
    expect(statuses).toEqual(before);
  });
});
