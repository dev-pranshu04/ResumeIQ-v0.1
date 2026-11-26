import type { z } from "zod";

/**
 * SERVER-ONLY. This module reads process.env.GROQ_API_KEY and must never be imported
 * from a client component. All callers in this codebase go through server functions
 * (see server-functions.ts), which run exclusively on the server.
 */

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";

// Groq shut down llama-3.3-70b-versatile and llama-3.1-8b-instant on 2026-08-16, so every
// request to them now fails. The replacements Groq recommends are the OpenAI GPT-OSS models:
// gpt-oss-120b (flagship, replaces the 70B) and gpt-oss-20b (fast, replaces the 8B).
// We try the primary model first and fall back to the fast one within the same request if
// the primary is rate-limited or unavailable.
const PRIMARY_MODEL = "openai/gpt-oss-120b";
const FALLBACK_MODEL = "openai/gpt-oss-20b";

// Retired/deprecated Groq model IDs mapped to their live replacement. A stale GROQ_MODEL
// (for example copied from an old .env.example) would otherwise pin the app to a dead
// model forever, so legacy IDs are treated as "unset" and the default pair is used.
const LEGACY_MODEL_MAP: Record<string, string> = {
  "llama-3.3-70b-versatile": PRIMARY_MODEL,
  "llama-3.1-8b-instant": FALLBACK_MODEL,
  "llama3-70b-8192": PRIMARY_MODEL,
  "llama3-8b-8192": FALLBACK_MODEL,
  "mixtral-8x7b-32768": PRIMARY_MODEL,
  "gemma2-9b-it": FALLBACK_MODEL,
  "deepseek-r1-distill-llama-70b": PRIMARY_MODEL,
  "qwen/qwen3-32b": PRIMARY_MODEL,
  "qwen/qwen3.6-27b": PRIMARY_MODEL,
  "meta-llama/llama-4-scout-17b-16e-instruct": PRIMARY_MODEL,
  "meta-llama/llama-4-maverick-17b-128e-instruct": PRIMARY_MODEL,
  "moonshotai/kimi-k2-instruct": PRIMARY_MODEL,
  "moonshotai/kimi-k2-instruct-0905": PRIMARY_MODEL,
};

/** Returns the operator-pinned model, or undefined if unset or a retired legacy ID. */
export function getPinnedModel(): string | undefined {
  const pinned = getEnv("GROQ_MODEL")?.trim();
  if (!pinned) return undefined;
  if (LEGACY_MODEL_MAP[pinned]) return undefined;
  return pinned;
}
const REQUEST_TIMEOUT_MS = 25_000;
const MAX_RETRY_AFTER_MS = 15_000;
// Below this much remaining time, another retry attempt isn't worth making — see the fix
// note at its use site in requestGroqChat for the zero-delay-retry-storm bug this closes.
const MIN_USEFUL_RETRY_WINDOW_MS = 250;

// Every caller now goes through this file's chunk-aware budgeting, so a full page's worth
// of AI content is built from several small, budget-safe requests instead of one big one.
// Individual requests stay fast; this deadline bounds the *whole* retry/backoff sequence
// for a single logical call, so a page can legitimately take up to ~60s across several
// calls without any single one hanging indefinitely.
const OVERALL_DEADLINE_MS = 55_000;

export class GroqConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GroqConfigError";
  }
}

export class GroqRequestError extends Error {
  constructor(
    message: string,
    public readonly kind:
      "timeout" | "rate-limit" | "network" | "server" | "model" | "unknown",
    public readonly retriable: boolean,
    /** Seconds the caller should wait before trying again, when Groq sends Retry-After. */
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = "GroqRequestError";
  }
}

export class GroqValidationError extends Error {
  constructor(
    message: string,
    public readonly raw: string,
  ) {
    super(message);
    this.name = "GroqValidationError";
  }
}

function getEnv(name: string): string | undefined {
  return typeof process !== "undefined" ? process.env[name] : undefined;
}

function requireApiKey(): string {
  const key = getEnv("GROQ_API_KEY");
  if (!key) {
    throw new GroqConfigError(
      "GROQ_API_KEY is not configured on the server. Add it to your environment variables.",
    );
  }
  return key;
}

function getPrimaryModel(): string {
  return getPinnedModel() || PRIMARY_MODEL;
}

function getFallbackModel(): string | null {
  // If the deployer pinned a (valid) custom GROQ_MODEL, don't second-guess it with an
  // implicit fallback — only fall back when we're the ones who picked the default.
  if (getPinnedModel()) return null;
  return FALLBACK_MODEL;
}

/** Caps a block of user-provided text so a single request can't blow the token budget. */
export function truncateForBudget(
  text: string,
  maxChars: number,
): { text: string; truncated: boolean } {
  if (text.length <= maxChars) return { text, truncated: false };
  return {
    text: `${text.slice(0, maxChars)}\n…[truncated ${text.length - maxChars} characters to stay within request limits]`,
    truncated: true,
  };
}

// Conservative chars-per-token estimate for the safety check below. Technical text
// (camelCase identifiers, acronyms) tokenizes denser than plain prose, so this
// deliberately undercounts chars/token rather than overcounting — the goal is to never
// under-estimate how many tokens a request will actually use.
const CHARS_PER_TOKEN_ESTIMATE = 3.3;
function estimateTokens(text: string): number {
  return Math.ceil(text.length / CHARS_PER_TOKEN_ESTIMATE);
}

// Groq's on-demand tier enforces a *per-model* tokens-per-minute ceiling that a single
// request (prompt + max_tokens) counts against. Both GPT-OSS models sit around 8,000 TPM on
// the free tier, so each gets a safe budget with margin below that ceiling for estimate error
// and system-prompt overhead. Unrecognized/custom-pinned models (via GROQ_MODEL) fall back
// to DEFAULT_SAFE_TOKEN_BUDGET, a conservative default.
const MODEL_TOKEN_BUDGETS: Record<string, number> = {
  "openai/gpt-oss-120b": 7_000,
  "openai/gpt-oss-20b": 7_000,
};
const DEFAULT_SAFE_TOKEN_BUDGET = 7_000;
const MIN_COMPLETION_TOKENS = 900;
// GPT-OSS models are reasoning models: hidden reasoning tokens are generated before the
// answer and count against max_tokens. Without extra headroom a long reasoning pass can use
// up the whole allowance and leave a truncated/empty JSON answer. We ask for low reasoning
// effort (see requestOnce) and add this headroom on top of the caller's requested tokens.
const REASONING_HEADROOM_TOKENS = 600;
// Below this, a model can't produce a useful completion for this request at all (prompt
// alone plus the smallest usable completion would exceed its budget) — so we skip it
// entirely rather than sending a request we already know will 413.
function safeBudgetFor(model: string): number {
  return MODEL_TOKEN_BUDGETS[model] ?? DEFAULT_SAFE_TOKEN_BUDGET;
}

/** Strips markdown code fences and leading/trailing prose so we can attempt JSON.parse. */
export function extractJsonCandidate(raw: string): string {
  let text = raw.trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced) {
    text = fenced[1].trim();
  }
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }
  return text;
}

async function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Best-effort circuit breaker shared across every call in this server instance/request
// lifecycle. The primary→fallback switch above assumes the fallback model sits on a
// separate quota bucket; when Groq is actually enforcing an account-wide limit (or both
// models are saturated together), that assumption is wrong, and without this, each
// roadmap/interview chunk call in a sequential run independently retries and burns its
// own full deadline against a wall that's already reported as exceeded — this is what
// produced the cluster of back-to-back "couldn't generate in time" branches (observed,
// not hypothetical: several branches failing within seconds of each other, then a later
// one succeeding once the window rolled over). Recording the wait once and having the
// *next* call in the sequence spend part of its own deadline waiting it out up front
// turns N independent failing retries into one shared, honored backoff.
let sharedCooldownUntil = 0;

/** Test-only: resets the shared cooldown so tests (and the A/B simulation in
 * groq-client.simulation.test.ts) start from a clean slate / can isolate its effect. */
export function __resetSharedCooldownForTests() {
  sharedCooldownUntil = 0;
}
// Capped well under a real 429's Retry-After so one bad signal can't stall an entire
// chunked run — this only smooths the common case, it doesn't replace per-call retry.
const MAX_SHARED_COOLDOWN_MS = 8000;

async function respectSharedCooldown(deadline: number) {
  const waitMs = Math.min(
    sharedCooldownUntil - Date.now(),
    MAX_SHARED_COOLDOWN_MS,
  );
  if (waitMs <= 0) return;
  const remainingMs = deadline - Date.now();
  if (remainingMs <= 0) return;
  await sleep(Math.min(waitMs, Math.max(remainingMs - 250, 0)));
}

interface GroqChatOptions {
  system: string;
  user: string;
  maxTokens?: number;
  temperature?: number;
  /**
   * Overrides OVERALL_DEADLINE_MS for this call. One-shot features (analysis, cover
   * letters, JD matching, etc.) want the full ~55s so a rate-limited request still has
   * room to succeed. Chunked features (roadmap branches, interview categories) call this
   * many times *in sequence* for one page, so each individual call needs its own much
   * shorter deadline — otherwise a single stuck chunk can silently burn through the whole
   * page's time budget before the next chunk even starts (this was an observed bug: a
   * branch call retrying for the full 55s left the client-side roadmap loop with zero time
   * for the remaining branches, which then all showed as "couldn't generate in time" even
   * though they were never actually attempted).
   */
  deadlineMs?: number;
  /**
   * Tries the fast model (llama-3.1-8b-instant) FIRST, falling back to the flagship model
   * only if it fails — the reverse of the default order. This is a real model-routing
   * decision, but a deliberately narrow one: since Groq's free tier has no per-token cost,
   * there's no cost incentive to route away from the flagship model, and quality (not
   * latency) is this app's actual constraint for reasoning-heavy tasks — so this is used
   * ONLY for calls whose output is short, low-stakes classification/summarization rather
   * than deep reasoning (see buildRoadmapSkeletonPrompt and buildInterviewSummaryPrompt),
   * where the 8B model's lower latency is a genuine UX win and the quality gap for that
   * kind of output is negligible. It is NOT applied blanket-wide, because doing so for
   * this app's actual reasoning-heavy calls (full analysis, roadmap branches, interview
   * questions) would trade real output quality for a speed gain nobody asked for.
   */
  preferFastModel?: boolean;
}

function parseRetryAfterMs(response: Response): number {
  const header = response.headers.get("retry-after");
  const seconds = header ? Number(header) : NaN;
  if (Number.isFinite(seconds) && seconds > 0) {
    return Math.min(seconds * 1000, MAX_RETRY_AFTER_MS);
  }
  return 4000;
}

async function requestOnce(
  model: string,
  {
    system,
    user,
    maxTokens,
    temperature,
  }: { system: string; user: string; maxTokens: number; temperature: number },
  apiKey: string,
): Promise<
  { ok: true; content: string } | { ok: false; error: GroqRequestError }
> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        max_tokens: maxTokens,
        response_format: { type: "json_object" },
        // GPT-OSS reasoning models: keep reasoning short and out of the response so the
        // message content is just the JSON we asked for.
        ...(model.startsWith("openai/gpt-oss")
          ? { reasoning_effort: "low", include_reasoning: false }
          : {}),
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
    });
    clearTimeout(timeout);

    if (response.status === 429) {
      const retryAfterSeconds = parseRetryAfterMs(response) / 1000;
      return {
        ok: false,
        error: new GroqRequestError(
          `Groq rate limit reached for ${model}.`,
          "rate-limit",
          true,
          retryAfterSeconds,
        ),
      };
    }
    if (response.status >= 500) {
      return {
        ok: false,
        error: new GroqRequestError(
          `Groq server error (${response.status}) for ${model}.`,
          "server",
          true,
        ),
      };
    }
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      // A retired/unknown model returns 404 (or 400) with model_not_found /
      // model_decommissioned. That's retriable *on a different model*, so surface it as
      // its own kind and let the caller move on to the next model instead of failing.
      if (
        response.status === 404 ||
        /model_not_found|model_decommissioned|decommissioned|does not exist|no longer supported/i.test(
          body,
        )
      ) {
        return {
          ok: false,
          error: new GroqRequestError(
            `Groq model ${model} is unavailable (${response.status}): ${body.slice(0, 200)}`,
            "model",
            true,
          ),
        };
      }
      return {
        ok: false,
        error: new GroqRequestError(
          `Groq request failed (${response.status}): ${body.slice(0, 200)}`,
          "unknown",
          false,
        ),
      };
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    const content = data.choices?.[0]?.message?.content;
    if (!content) {
      return {
        ok: false,
        error: new GroqRequestError(
          "Groq returned an empty response.",
          "unknown",
          true,
        ),
      };
    }
    return { ok: true, content };
  } catch (error) {
    clearTimeout(timeout);
    if (error instanceof Error && error.name === "AbortError") {
      return {
        ok: false,
        error: new GroqRequestError(
          `Groq request to ${model} timed out.`,
          "timeout",
          true,
        ),
      };
    }
    return {
      ok: false,
      error: new GroqRequestError(
        `Network error contacting Groq: ${error instanceof Error ? error.message : String(error)}`,
        "network",
        true,
      ),
    };
  }
}

/**
 * Tries the primary model first. On rate-limit specifically, it immediately tries the
 * fallback model (a separate quota bucket on Groq) instead of waiting and re-hitting the
 * same limit — this is what actually avoids the "AI service is rate-limited" screen for
 * the common case. Only sleeps (honoring Retry-After) when every model option is
 * exhausted, and only for retriable, non-rate-limit failures (timeouts, 5xx, network).
 *
 * A slow-but-successful response is the goal, not a fast failure: this keeps retrying
 * (honoring Retry-After, with backoff) across every viable model until OVERALL_DEADLINE_MS
 * is spent, rather than giving up after a couple of attempts. Callers that want their own
 * chunk of a larger flow to stay small and fast should shrink `maxTokens` and the prompt
 * itself — see prompts.ts's staged/skeleton builders — rather than relying on this loop to
 * paper over a request that's simply too big for any model's budget.
 */
async function requestGroqChat({
  system,
  user,
  maxTokens = 2200,
  temperature = 0.3,
  deadlineMs = OVERALL_DEADLINE_MS,
  preferFastModel = false,
}: GroqChatOptions): Promise<string> {
  const apiKey = requireApiKey();
  let allModels = [getPrimaryModel(), getFallbackModel()].filter(
    (m, i, arr): m is string => !!m && arr.indexOf(m) === i,
  );
  if (preferFastModel && allModels.length > 1) {
    // Move the fallback (fast) model to the front of the attempt order. Everything
    // downstream — budget viability filtering, retry/backoff, the shared cooldown —
    // is unchanged and unaware of this; it just sees a different first model to try.
    const fastModel = getFallbackModel();
    allModels = [
      ...allModels.filter((m) => m === fastModel),
      ...allModels.filter((m) => m !== fastModel),
    ];
  }

  const promptTokens = estimateTokens(system) + estimateTokens(user);

  // Only attempt models the prompt can plausibly fit on (prompt + a minimally useful
  // completion must clear that model's safe budget) — sending a request we already know
  // is oversized just wastes a round trip and reproduces the 413 the fallback model kept
  // hitting. If every model is too small for this prompt, keep the primary model anyway
  // (best effort) so we still get a real, if truncated-completion, attempt and error
  // message rather than silently doing nothing.
  const viableModels = allModels.filter(
    (m) => promptTokens + MIN_COMPLETION_TOKENS <= safeBudgetFor(m),
  );
  const models = viableModels.length > 0 ? viableModels : [allModels[0]];

  function budgetedMaxTokensFor(model: string): number {
    return Math.max(
      MIN_COMPLETION_TOKENS,
      Math.min(
        maxTokens + REASONING_HEADROOM_TOKENS,
        safeBudgetFor(model) - promptTokens,
      ),
    );
  }

  let lastError: GroqRequestError | null = null;
  const deadline = Date.now() + deadlineMs;
  let attempt = 0;

  await respectSharedCooldown(deadline);

  while (Date.now() < deadline) {
    const model = models[Math.min(attempt, models.length - 1)];
    const result = await requestOnce(
      model,
      { system, user, maxTokens: budgetedMaxTokensFor(model), temperature },
      apiKey,
    );

    if (result.ok) return result.content;
    lastError = result.error;

    if (lastError.kind === "rate-limit") {
      // Record the wait for the *next* call in a chunked sequence, regardless of whether
      // this call itself goes on to retry — the point is to warn calls we haven't made
      // yet, not just this one.
      const waitMs = (lastError.retryAfterSeconds ?? 4) * 1000;
      sharedCooldownUntil = Math.max(sharedCooldownUntil, Date.now() + waitMs);
    }

    if (!lastError.retriable) throw lastError;

    const nextModel = models[Math.min(attempt + 1, models.length - 1)];
    const movingToNewModel = nextModel !== model;
    attempt += 1;

    if (lastError.kind === "model") {
      // This model is gone/unknown — retrying it is pointless. Hop straight to the next
      // model with no delay; if there isn't one, fail now instead of looping to the deadline.
      if (!movingToNewModel) throw lastError;
      continue;
    }

    if (lastError.kind === "rate-limit" && movingToNewModel) {
      // Different model *might* be a different quota bucket on Groq's side — but that's
      // an assumption, not something this code can verify, and if Groq actually enforces
      // rate limits per API key/account rather than strictly per model, firing the next
      // request with zero delay doesn't help and just adds another request against the
      // same limit. A short, cheap pause hedges against that uncertainty without
      // meaningfully slowing down the common case where it genuinely is a separate bucket.
      //
      // Bug fixed here (found via simulation, not observed live): this used to check only
      // `remainingMs <= 0`, then clamp the sleep to `max(remainingMs - 250, 0)`. Once under
      // 250ms remained, that clamp produced sleep(0) — so instead of stopping, the loop
      // kept looping with no delay at all, firing a burst of zero-backoff requests (dozens
      // to hundreds, in a real reproduction) right at the tail of the deadline. That's the
      // opposite of honoring Retry-After, and it's extra load on an account that's already
      // being rate-limited. Requiring a real minimum window before attempting again — not
      // just "any time at all" — closes that: once too little time is left for a
      // meaningful attempt, stop and surface the last real error instead of spinning.
      const remainingMs = deadline - Date.now();
      if (remainingMs <= MIN_USEFUL_RETRY_WINDOW_MS) break;
      await sleep(Math.min(400, remainingMs - 250));
      continue;
    }

    const backoffMs =
      lastError.kind === "rate-limit"
        ? (lastError.retryAfterSeconds ?? 4) * 1000
        : Math.min(500 * 2 ** attempt, 8000);
    const remainingMs = deadline - Date.now();
    if (remainingMs <= MIN_USEFUL_RETRY_WINDOW_MS) break;
    await sleep(Math.min(backoffMs, remainingMs - 250));
  }

  throw (
    lastError ??
    new GroqRequestError(
      "Groq request failed for an unknown reason.",
      "unknown",
      false,
    )
  );
}

/**
 * Calls Groq, asks for JSON, validates against the given Zod schema. On a validation
 * failure, makes exactly one repair attempt (re-asking the model to fix its own output
 * against the validation error) before giving up with a typed GroqValidationError.
 *
 * The repair attempt always gets its own short, fixed deadline (REPAIR_DEADLINE_MS)
 * regardless of the caller's `deadlineMs` — it's a small, bounded "fix your own JSON" ask,
 * not a from-scratch generation, so it doesn't need the same retry budget as the original
 * call. This keeps a chunked caller's worst-case total time at `deadlineMs +
 * REPAIR_DEADLINE_MS`, not `deadlineMs * 2` (which was the actual cause of Career Roadmap
 * branches burning through the whole page's time budget on a single stuck branch).
 */
const REPAIR_DEADLINE_MS = 12_000;

export async function callGroqStructured<S extends z.ZodTypeAny>({
  system,
  user,
  schema,
  maxTokens,
  temperature,
  deadlineMs,
  preferFastModel,
}: GroqChatOptions & { schema: S }): Promise<z.infer<S>> {
  const raw = await requestGroqChat({
    system,
    user,
    maxTokens,
    temperature,
    deadlineMs,
    preferFastModel,
  });
  const candidate = extractJsonCandidate(raw);

  const firstAttempt = safeParseJson(candidate);
  if (firstAttempt.ok) {
    const validated = schema.safeParse(firstAttempt.value);
    if (validated.success) return validated.data;

    // One bounded repair attempt: show the model its own output and the validation error.
    // Deliberately does NOT inherit preferFastModel — a repair attempt means something
    // already went wrong once, so this prioritizes correctness over speed for the retry
    // regardless of how the original call was routed.
    const repaired = await requestGroqChat({
      system:
        system +
        "\n\nYou previously returned JSON that failed schema validation. Return ONLY corrected JSON, no prose.",
      user: `Your previous output:\n${candidate}\n\nValidation error:\n${validated.error.message}\n\nOriginal request:\n${user}`,
      maxTokens,
      temperature: 0.1,
      deadlineMs: REPAIR_DEADLINE_MS,
    });
    const repairedCandidate = extractJsonCandidate(repaired);
    const repairedParsed = safeParseJson(repairedCandidate);
    if (repairedParsed.ok) {
      const repairedValidated = schema.safeParse(repairedParsed.value);
      if (repairedValidated.success) return repairedValidated.data;
      throw new GroqValidationError(
        `AI response failed validation after repair attempt: ${repairedValidated.error.message}`,
        repairedCandidate,
      );
    }
    throw new GroqValidationError(
      "AI response was not valid JSON after repair attempt.",
      repairedCandidate,
    );
  }

  throw new GroqValidationError("AI response was not valid JSON.", candidate);
}

function safeParseJson(
  text: string,
): { ok: true; value: unknown } | { ok: false } {
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false };
  }
}
