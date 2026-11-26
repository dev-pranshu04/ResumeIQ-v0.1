import { createMiddleware } from "@tanstack/react-start";
import { getRequest } from "@tanstack/react-start/server";

/**
 * Real business risk this closes: every AI-calling server function runs against a single
 * shared Groq API key (see .env.example / README). Without any limiter, one script (or
 * one careless retry loop in a browser tab) can call analyzeResumeFn/generateCoverLetterFn/
 * etc. an unbounded number of times, each one a real, billed Groq request against the
 * deploy owner's account — a cost-abuse vector, not a hypothetical one.
 *
 * This is an in-memory, per-server-instance sliding-window limiter, applied per-IP. Two
 * honest limitations, stated plainly rather than glossed over:
 * 1. On serverless/edge deploys (this app targets Vercel per vercel.json) it resets on
 *    cold start and isn't shared across concurrent instances — it raises the cost/effort
 *    of abuse, it does not eliminate it. A durable shared store (e.g. Upstash Redis) is
 *    the real fix if this is genuinely at risk of being hammered in production.
 * 2. IP-based limiting is defeated by anyone rotating IPs; it stops casual/accidental
 *    abuse (a stuck retry loop, a curious script), not a determined attacker.
 * Both are true of the pattern in TanStack Start's own documented rate-limiting example
 * this follows — it's the standard first layer, not a complete solution.
 */
const buckets = new Map<string, { count: number; windowStart: number }>();

/** Test-only: clears all tracked buckets so each test starts from a clean slate. */
export function __resetRateLimitStateForTests() {
  buckets.clear();
}

// Best-effort bound so `buckets` itself can't grow without limit under a distributed
// scan of many fake IPs — same class of fix as the AI result cache above.
const MAX_TRACKED_KEYS = 5000;

export function consume(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart >= windowMs) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      const oldestKey = buckets.keys().next().value;
      if (oldestKey !== undefined) buckets.delete(oldestKey);
    }
    buckets.set(key, { count: 1, windowStart: now });
    return true;
  }
  if (bucket.count >= max) return false;
  bucket.count += 1;
  return true;
}

/**
 * Per-IP sliding-window rate-limit middleware for a `createServerFn`.
 * Usage: `.middleware([rateLimitMiddleware({ key: "analyze", max: 20, windowMs: 60_000 })])`
 */
export function rateLimitMiddleware(opts: {
  key: string;
  max: number;
  windowMs: number;
}) {
  return createMiddleware().server(async ({ next }) => {
    const request = getRequest();
    const ip =
      request.headers.get("cf-connecting-ip") ??
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";
    const allowed = consume(`${opts.key}:${ip}`, opts.max, opts.windowMs);
    if (!allowed) {
      const error = new Error(
        "Too many requests — please wait a minute and try again.",
      ) as Error & { statusCode?: number };
      error.statusCode = 429;
      throw error;
    }
    return next();
  });
}
