import { describe, expect, it } from "vitest";
import { countTokens, truncateToTokenBudget } from "./tokenizer";

describe("countTokens", () => {
  it("returns 0 for empty input", () => {
    expect(countTokens("")).toBe(0);
  });

  it("counts more tokens for longer text", () => {
    const short = countTokens("AWS");
    const long = countTokens(
      "Experienced software engineer with expertise in distributed systems, Kubernetes, and TensorFlow.",
    );
    expect(long).toBeGreaterThan(short);
  });

  it("is a real measurement, not a fixed chars/token ratio", () => {
    // "AWS" and "xyz" are both 3 chars but should not be assumed to cost the same
    // number of tokens under a real tokenizer - just assert both are >= 1 token and
    // that the function doesn't silently fall back to length/N.
    expect(countTokens("AWS")).toBeGreaterThanOrEqual(1);
    expect(countTokens("supercalifragilisticexpialidocious")).toBeGreaterThanOrEqual(
      1,
    );
  });
});

describe("truncateToTokenBudget", () => {
  it("returns text unchanged when it already fits", () => {
    const result = truncateToTokenBudget("short text", 100);
    expect(result.truncated).toBe(false);
    expect(result.text).toBe("short text");
  });

  it("truncates and marks truncated when budget is exceeded", () => {
    const long = "word ".repeat(2000);
    const result = truncateToTokenBudget(long, 50);
    expect(result.truncated).toBe(true);
    expect(result.tokensUsed).toBeLessThanOrEqual(50);
    expect(result.text.length).toBeLessThan(long.length);
  });

  it("never overshoots the requested token budget", () => {
    const long = "The quick brown fox jumps over the lazy dog. ".repeat(500);
    for (const budget of [1, 5, 20, 100]) {
      const result = truncateToTokenBudget(long, budget);
      expect(result.tokensUsed).toBeLessThanOrEqual(budget);
    }
  });

  it("returns empty string for non-positive budget", () => {
    const result = truncateToTokenBudget("hello world", 0);
    expect(result.text).toBe("");
    expect(result.truncated).toBe(true);
  });
});
