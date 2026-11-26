import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetRateLimitStateForTests, consume } from "./rate-limit";

describe("consume (sliding-window rate limiter core)", () => {
  beforeEach(() => {
    __resetRateLimitStateForTests();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("allows requests up to the max within the window", () => {
    for (let i = 0; i < 5; i++) {
      expect(consume("k", 5, 60_000)).toBe(true);
    }
  });

  it("blocks the request that would exceed max within the window", () => {
    for (let i = 0; i < 5; i++) consume("k", 5, 60_000);
    expect(consume("k", 5, 60_000)).toBe(false);
  });

  it("resets the count once the window has elapsed", () => {
    for (let i = 0; i < 5; i++) consume("k", 5, 60_000);
    expect(consume("k", 5, 60_000)).toBe(false); // exhausted

    vi.advanceTimersByTime(60_001);

    expect(consume("k", 5, 60_000)).toBe(true); // fresh window
  });

  it("does not reset early — still blocked just before the window elapses", () => {
    for (let i = 0; i < 5; i++) consume("k", 5, 60_000);
    vi.advanceTimersByTime(59_999);
    expect(consume("k", 5, 60_000)).toBe(false);
  });

  it("tracks independent keys separately (per-IP isolation)", () => {
    for (let i = 0; i < 5; i++) consume("ip-a", 5, 60_000);
    expect(consume("ip-a", 5, 60_000)).toBe(false);
    // A different key (a different caller's IP) is unaffected by ip-a's usage.
    expect(consume("ip-b", 5, 60_000)).toBe(true);
  });

  it("respects a different max/window pair passed for a different limiter key", () => {
    expect(consume("strict", 1, 60_000)).toBe(true);
    expect(consume("strict", 1, 60_000)).toBe(false);
  });
});
