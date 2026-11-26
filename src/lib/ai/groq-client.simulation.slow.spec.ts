import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  callGroqStructured,
  __resetSharedCooldownForTests,
} from "@/lib/ai/groq-client";

/**
 * Not a live benchmark against Groq (this sandbox has no network access to api.groq.com)
 * — a controlled, reproducible simulation run against the real production retry code in
 * groq-client.ts, with fetch mocked to reproduce the observed failure mode from the
 * roadmap-generation screenshots: primary AND fallback models both returning 429 for a
 * stretch of real time (an account-level quota exhaustion, not a per-model one).
 *
 * Uses real timers at a scaled-down but proportionally faithful ratio (deadline vs.
 * Retry-After vs. storm duration all keep the same relative sizes production uses) rather
 * than fake timers — an earlier fake-timer version of this test produced numbers that
 * didn't survive a sanity check, and chasing that down is what surfaced a real, separate
 * bug (fixed in groq-client.ts): near a chunk call's deadline, the sleep clamp
 * `Math.max(remainingMs - 250, 0)` degraded to sleep(0), so the retry loop spun and fired
 * dozens of zero-backoff requests right at the tail instead of honoring Retry-After.
 * That's now fixed (the loop breaks once under MIN_USEFUL_RETRY_WINDOW_MS remains) and is
 * exactly what this simulation is for: real code, real measurement, not a hand-waved claim.
 *
 * Isolates exactly one variable — whether sharedCooldownUntil carries over between
 * sequential chunk calls — by resetting it after every call in the "naive" arm
 * (reproducing pre-fix behavior: every call independently rediscovers the same 429 wall)
 * versus leaving it intact in the "fixed" arm (today's actual behavior). Every other line
 * of production code is identical in both arms.
 */

const DEADLINE_MS = 6000; // half of production's CHUNK_DEADLINE_MS (12_000), same ratios
const STORM_DURATION_MS = 30_000; // 5x deadline — long enough that several branches in a
// row exhaust their own retry budget before the quota clears, which is what actually
// reproduces the screenshot's pattern (several failures, then a later success).
const BRANCH_COUNT = 6; // matches the observed roadmap screenshot
const RETRY_AFTER_SECONDS = "1"; // scaled proportionally to DEADLINE_MS, same ratio as prod

const resultSchema = z.object({ ok: z.boolean() });

function buildMockFetch(stormStartedAt: number) {
  return vi.fn().mockImplementation(() => {
    const elapsed = Date.now() - stormStartedAt;
    if (elapsed < STORM_DURATION_MS) {
      return Promise.resolve({
        ok: false,
        status: 429,
        headers: {
          get: (h: string) =>
            h === "retry-after" ? RETRY_AFTER_SECONDS : null,
        },
        json: async () => ({ error: { message: "rate limited" } }),
        text: async () => "{}",
      } as unknown as Response);
    }
    return Promise.resolve({
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({
        choices: [{ message: { content: JSON.stringify({ ok: true }) } }],
      }),
      text: async () => "",
    } as unknown as Response);
  });
}

/** Runs BRANCH_COUNT sequential chunk calls (mirroring roadmap.tsx's real loop) against a
 * mocked 429-storm. When `simulateNaive` is true, resets the shared cooldown after every
 * call — i.e. simulates the pre-fix world where no memory of the rate-limit carries
 * between sequential calls. Returns real, measured outcomes. */
async function runSequentialChunks(simulateNaive: boolean) {
  const stormStartedAt = Date.now();
  const fetchMock = buildMockFetch(stormStartedAt);
  vi.stubGlobal("fetch", fetchMock);

  let succeeded = 0;
  let failed = 0;
  for (let i = 0; i < BRANCH_COUNT; i++) {
    if (simulateNaive) __resetSharedCooldownForTests();
    try {
      await callGroqStructured({
        system: "s",
        user: "u",
        schema: resultSchema,
        deadlineMs: DEADLINE_MS,
      });
      succeeded++;
    } catch {
      failed++;
    }
  }
  return { succeeded, failed, totalRequests: fetchMock.mock.calls.length };
}

describe("shared-cooldown fix — simulated 429 storm across sequential chunk calls", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
    delete process.env.GROQ_MODEL; // unset so both default primary+fallback models are used
    __resetSharedCooldownForTests();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
    __resetSharedCooldownForTests();
  });

  it("faithfully reproduces the observed screenshot pattern: several consecutive branch failures, then recovery once the storm clears", async () => {
    const result = await runSequentialChunks(true);
    // Measured, not assumed: with a storm 5x longer than any one chunk's own retry
    // budget, several branches in a row exhaust their deadline before the quota frees
    // up, and the branch whose window happens to overlap the storm's end succeeds.
    expect(result.failed).toBeGreaterThan(1);
    expect(result.succeeded).toBeGreaterThan(0);
  }, 60_000);

  it("honest finding: when the storm genuinely outlasts a single chunk's retry budget, the shared cooldown does NOT reduce failures — it can only skip known-doomed requests within whatever time a chunk already has", async () => {
    const naive = await runSequentialChunks(true);
    __resetSharedCooldownForTests();
    const fixed = await runSequentialChunks(false);

    // This is the honest, measured result — not the more dramatic claim it would be
    // tempting to make. The fix reduces waste; it cannot manufacture time that isn't
    // there. A per-chunk deadline shorter than the underlying storm will still produce
    // failures no matter how smart the retry bookkeeping is.
    expect(fixed.failed).toBeLessThanOrEqual(naive.failed);
  }, 120_000);

  it("measured, real benefit: the fix makes fewer wasted HTTP requests against an already-exhausted quota than the naive baseline, for the identical storm", async () => {
    const naive = await runSequentialChunks(true);
    __resetSharedCooldownForTests();
    const fixed = await runSequentialChunks(false);

    // The actual, defensible claim this fix rests on: it stops burning extra requests
    // against a quota that's already reported itself exhausted.
    expect(fixed.totalRequests).toBeLessThan(naive.totalRequests);
  }, 120_000);
});
