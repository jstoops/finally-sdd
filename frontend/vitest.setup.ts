// Global test setup: jest-dom matchers, a fake EventSource and a ResizeObserver stub
// (jsdom has neither). Vitest globals are off, so cleanup is registered explicitly.
import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach, vi } from "vitest";

import { FakeEventSource } from "./src/test/FakeEventSource";

globalThis.EventSource = FakeEventSource as unknown as typeof EventSource;

if (typeof globalThis.ResizeObserver === "undefined") {
  class ResizeObserverStub {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  globalThis.ResizeObserver = ResizeObserverStub as unknown as typeof ResizeObserver;
}

afterEach(() => {
  cleanup();
  FakeEventSource.reset();
  vi.useRealTimers();
});
