import { describe, expect, it } from "vitest";
import { buildBudgetedResumeContext } from "./budget";
import { countTokens } from "./tokenizer";

const SMALL_RESUME = `
EXPERIENCE
Software Engineer, Acme Corp
- Built things

SKILLS
TypeScript, React
`;

function buildLargeResume(): string {
  const job = (n: number) =>
    `Software Engineer, Company ${n}\n2020 - 2021\n- Did impactful work number ${n} with real measurable outcomes and detailed context sentences to inflate length.`;
  const jobs = Array.from({ length: 40 }, (_, i) => job(i)).join("\n\n");
  return `EXPERIENCE\n\n${jobs}\n\nAWARDS\n\nDean's List 2019\nEmployee of the Month 2021\n\nPUBLICATIONS\n\nSome Paper Title, 2022\n`;
}

describe("buildBudgetedResumeContext", () => {
  it("returns text unchanged when it already fits the budget", () => {
    const result = buildBudgetedResumeContext(SMALL_RESUME, 5000);
    expect(result.wasCompressed).toBe(false);
    expect(result.text).toContain("Acme Corp");
    expect(result.text).toContain("TypeScript");
  });

  it("never exceeds the requested token budget", () => {
    const large = buildLargeResume();
    const budget = 200;
    const result = buildBudgetedResumeContext(large, budget);
    expect(result.tokensUsed).toBeLessThanOrEqual(budget);
  });

  it("drops lower-priority sections (Awards/Publications) before Experience under pressure", () => {
    const large = buildLargeResume();
    const result = buildBudgetedResumeContext(large, 150);
    expect(result.wasCompressed).toBe(true);
    expect(result.text).toContain("Company 0");
    expect(result.text).not.toContain("Dean's List");
    expect(result.text).not.toContain("Some Paper Title");
  });

  it("returns empty context for empty input", () => {
    const result = buildBudgetedResumeContext("", 1000);
    expect(result.text).toBe("");
    expect(result.wasCompressed).toBe(false);
  });

  it("makes forward progress even when a single chunk alone exceeds the budget", () => {
    const hugeSingleBlock = "EXPERIENCE\n" + "Detailed sentence about work. ".repeat(500);
    const result = buildBudgetedResumeContext(hugeSingleBlock, 30);
    expect(result.text.length).toBeGreaterThan(0);
    expect(result.tokensUsed).toBeLessThanOrEqual(30);
  });

  it("tokensUsed matches a real recount of the returned text", () => {
    const large = buildLargeResume();
    const result = buildBudgetedResumeContext(large, 300);
    expect(result.tokensUsed).toBe(countTokens(result.text));
  });
});
