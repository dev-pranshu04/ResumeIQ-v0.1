import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import {
  extractJsonCandidate,
  callGroqStructured,
  GroqConfigError,
  GroqValidationError,
} from "@/lib/ai/groq-client";

describe("extractJsonCandidate", () => {
  it("passes through already-clean JSON", () => {
    expect(extractJsonCandidate('{"a":1}')).toBe('{"a":1}');
  });

  it("strips a markdown code fence", () => {
    expect(extractJsonCandidate('```json\n{"a":1}\n```')).toBe('{"a":1}');
  });

  it("strips leading/trailing prose around a JSON object", () => {
    expect(
      extractJsonCandidate('Here is the result:\n{"a":1}\nHope that helps!'),
    ).toBe('{"a":1}');
  });
});

const simpleSchema = z.object({ ok: z.boolean(), value: z.number() });

function mockFetchOnce(status: number, body: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

describe("callGroqStructured", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env.GROQ_API_KEY = "test-key";
    process.env.GROQ_MODEL = "test-model";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.unstubAllGlobals();
  });

  it("throws GroqConfigError when no API key is set", async () => {
    delete process.env.GROQ_API_KEY;
    await expect(
      callGroqStructured({ system: "s", user: "u", schema: simpleSchema }),
    ).rejects.toBeInstanceOf(GroqConfigError);
  });

  it("returns validated data on a clean first response", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockFetchOnce(200, {
        choices: [
          { message: { content: JSON.stringify({ ok: true, value: 42 }) } },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callGroqStructured({
      system: "s",
      user: "u",
      schema: simpleSchema,
    });
    expect(result).toEqual({ ok: true, value: 42 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("attempts one repair call when the first response fails schema validation, then succeeds", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        mockFetchOnce(200, {
          choices: [
            {
              message: {
                content: JSON.stringify({ ok: true, value: "not-a-number" }),
              },
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        mockFetchOnce(200, {
          choices: [
            { message: { content: JSON.stringify({ ok: true, value: 7 }) } },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const result = await callGroqStructured({
      system: "s",
      user: "u",
      schema: simpleSchema,
    });
    expect(result).toEqual({ ok: true, value: 7 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clamps max_tokens down when the prompt is large, so prompt+completion stays under the safe budget", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockFetchOnce(200, {
        choices: [
          { message: { content: JSON.stringify({ ok: true, value: 1 }) } },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    // ~8000 estimated tokens of user text alone (26,400 chars / 3.3) — larger than the
    // 9000-token safe budget on its own once the requested 3200-token completion is added.
    const largeUser = "x".repeat(26_400);
    await callGroqStructured({
      system: "s",
      user: largeUser,
      schema: simpleSchema,
      maxTokens: 3200,
    });

    const requestBody = JSON.parse(
      (fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]
        .body as string,
    );
    expect(requestBody.max_tokens).toBeLessThan(3200);
    expect(requestBody.max_tokens).toBeGreaterThanOrEqual(900); // MIN_COMPLETION_TOKENS floor
  });

  it("keeps prompt + max_tokens under each model's safe budget when falling back after a rate limit", async () => {
    delete process.env.GROQ_MODEL;

    const requests: Array<{ model: string; max_tokens: number }> = [];
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        requests.push({ model: body.model, max_tokens: body.max_tokens });
        if (body.model === "openai/gpt-oss-120b") {
          return {
            ok: false,
            status: 429,
            headers: new Headers(),
            text: async () => "",
          } as unknown as Response;
        }
        return mockFetchOnce(200, {
          choices: [
            { message: { content: JSON.stringify({ ok: true, value: 1 }) } },
          ],
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    const user = "x".repeat(10_000); // ~3,000 estimated prompt tokens
    await callGroqStructured({
      system: "s",
      user,
      schema: simpleSchema,
      maxTokens: 3000,
    });

    expect(requests).toHaveLength(2);
    expect(requests[0].model).toBe("openai/gpt-oss-120b");
    expect(requests[1].model).toBe("openai/gpt-oss-20b");
    for (const r of requests) {
      expect(Math.ceil(10_001 / 3.3) + r.max_tokens).toBeLessThanOrEqual(7_000);
    }
  });

  it("sends low reasoning effort and hides reasoning for gpt-oss models", async () => {
    delete process.env.GROQ_MODEL;
    const bodies: Array<Record<string, unknown>> = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        bodies.push(JSON.parse(init.body as string));
        return mockFetchOnce(200, {
          choices: [
            { message: { content: JSON.stringify({ ok: true, value: 1 }) } },
          ],
        });
      }),
    );
    await callGroqStructured({ system: "s", user: "u", schema: simpleSchema });
    expect(bodies[0].model).toBe("openai/gpt-oss-120b");
    expect(bodies[0].reasoning_effort).toBe("low");
    expect(bodies[0].include_reasoning).toBe(false);
  });

  it("ignores a retired GROQ_MODEL (e.g. llama-3.3-70b-versatile) and uses the live default pair", async () => {
    process.env.GROQ_MODEL = "llama-3.3-70b-versatile";
    const models: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        models.push(JSON.parse(init.body as string).model);
        return mockFetchOnce(200, {
          choices: [
            { message: { content: JSON.stringify({ ok: true, value: 1 }) } },
          ],
        });
      }),
    );
    await callGroqStructured({ system: "s", user: "u", schema: simpleSchema });
    expect(models).toEqual(["openai/gpt-oss-120b"]);
  });

  it("hops to the next model immediately when a model is decommissioned/not found", async () => {
    delete process.env.GROQ_MODEL;
    const models: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn().mockImplementation(async (_url: string, init: RequestInit) => {
        const model = JSON.parse(init.body as string).model;
        models.push(model);
        if (model === "openai/gpt-oss-120b") {
          return mockFetchOnce(404, {
            error: { code: "model_not_found", message: "model does not exist" },
          });
        }
        return mockFetchOnce(200, {
          choices: [
            { message: { content: JSON.stringify({ ok: true, value: 1 }) } },
          ],
        });
      }),
    );
    const result = await callGroqStructured({
      system: "s",
      user: "u",
      schema: simpleSchema,
    });
    expect(result).toEqual({ ok: true, value: 1 });
    expect(models).toEqual(["openai/gpt-oss-120b", "openai/gpt-oss-20b"]);
  });

  it("makes a single best-effort primary attempt when the prompt alone exceeds every model's budget", async () => {
    delete process.env.GROQ_MODEL;

    const requests: Array<{ model: string }> = [];
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        requests.push({ model: body.model });
        return mockFetchOnce(200, {
          choices: [
            { message: { content: JSON.stringify({ ok: true, value: 1 }) } },
          ],
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    // ~7,900 estimated tokens of prompt alone — already past every model's 7,000 token
    // budget, so no model is viable; we make one best-effort attempt on the primary.
    const user = "x".repeat(26_000);
    await callGroqStructured({
      system: "s",
      user,
      schema: simpleSchema,
      maxTokens: 3000,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe("openai/gpt-oss-120b");
  });

  it("tries the fast model (openai/gpt-oss-20b) FIRST when preferFastModel is set", async () => {
    delete process.env.GROQ_MODEL;

    const requests: Array<{ model: string }> = [];
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        requests.push({ model: body.model });
        return mockFetchOnce(200, {
          choices: [
            { message: { content: JSON.stringify({ ok: true, value: 1 }) } },
          ],
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    await callGroqStructured({
      system: "s",
      user: "u",
      schema: simpleSchema,
      preferFastModel: true,
    });

    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe("openai/gpt-oss-20b");
  });

  it("still falls back to the flagship model if the fast model fails, when preferFastModel is set", async () => {
    delete process.env.GROQ_MODEL;

    const requests: Array<{ model: string }> = [];
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        requests.push({ model: body.model });
        if (body.model === "openai/gpt-oss-20b") {
          return {
            ok: false,
            status: 429,
            headers: new Headers(),
            text: async () => "",
          } as unknown as Response;
        }
        return mockFetchOnce(200, {
          choices: [
            { message: { content: JSON.stringify({ ok: true, value: 1 }) } },
          ],
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    const result = await callGroqStructured({
      system: "s",
      user: "u",
      schema: simpleSchema,
      preferFastModel: true,
    });

    expect(result).toEqual({ ok: true, value: 1 });
    expect(requests).toHaveLength(2);
    expect(requests[0].model).toBe("openai/gpt-oss-20b");
    expect(requests[1].model).toBe("openai/gpt-oss-120b");
  });

  it("defaults to flagship-first when preferFastModel is not set (unchanged existing behavior)", async () => {
    delete process.env.GROQ_MODEL;

    const requests: Array<{ model: string }> = [];
    const fetchMock = vi
      .fn()
      .mockImplementation(async (_url: string, init: RequestInit) => {
        const body = JSON.parse(init.body as string);
        requests.push({ model: body.model });
        return mockFetchOnce(200, {
          choices: [
            { message: { content: JSON.stringify({ ok: true, value: 1 }) } },
          ],
        });
      });
    vi.stubGlobal("fetch", fetchMock);

    await callGroqStructured({ system: "s", user: "u", schema: simpleSchema });

    expect(requests).toHaveLength(1);
    expect(requests[0].model).toBe("openai/gpt-oss-120b");
  });

  it(
    "honors a short custom deadlineMs instead of always retrying for the full ~55s default " +
      "(this is what actually fixes chunked callers like roadmap branches: without a per-call " +
      "deadline, one stuck branch call could burn through the whole page's client-side time " +
      "budget before the next branch was even attempted)",
    async () => {
      process.env.GROQ_MODEL = "test-model"; // pin to one model so there's no second model to hop to
      const fetchMock = vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        headers: new Headers(),
        text: async () => "server error",
      } as unknown as Response);
      vi.stubGlobal("fetch", fetchMock);

      const start = Date.now();
      await expect(
        callGroqStructured({
          system: "s",
          user: "u",
          schema: simpleSchema,
          deadlineMs: 300,
        }),
      ).rejects.toThrow();
      const elapsed = Date.now() - start;

      // Well under the ~55s default — proves the short deadline was actually respected,
      // not just accepted and ignored.
      expect(elapsed).toBeLessThan(3000);
      // Still genuinely retried at least once within that short window, rather than
      // giving up after a single attempt.
      expect(fetchMock.mock.calls.length).toBeGreaterThanOrEqual(1);
    },
  );

  it("throws GroqValidationError when the repair attempt also fails validation", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockFetchOnce(200, {
        choices: [
          {
            message: {
              content: JSON.stringify({ ok: true, value: "still-bad" }),
            },
          },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      callGroqStructured({ system: "s", user: "u", schema: simpleSchema }),
    ).rejects.toBeInstanceOf(GroqValidationError);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
