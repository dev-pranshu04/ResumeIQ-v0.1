import { describe, expect, it } from "vitest";
import { chunkResume } from "../chunker";
import { detectSections, normalizeResumeText } from "../section-detector";
import { EVAL_CASES } from "./dataset";
import { runRetrievalEval } from "./run-retrieval-eval";

describe("EVAL_CASES dataset integrity", () => {
  it("every expectedContentSubstring actually exists in its resume's chunks (a typo here would silently count as a permanent miss)", () => {
    for (const evalCase of EVAL_CASES) {
      const sections = detectSections(normalizeResumeText(evalCase.resume));
      const chunks = chunkResume(sections);
      for (const req of evalCase.requirements) {
        if (!req.shouldMatch) continue;
        expect(req.expectedContentSubstring, `${evalCase.name}: "${req.requirement}" is shouldMatch:true but has no expectedContentSubstring`).toBeTruthy();
        const found = chunks.some((c) =>
          c.content.includes(req.expectedContentSubstring!),
        );
        expect(
          found,
          `${evalCase.name}: expectedContentSubstring "${req.expectedContentSubstring}" not found in any chunk`,
        ).toBe(true);
      }
    }
  });

  it("every shouldMatch:false requirement has no expectedContentSubstring set (would be dead/misleading data)", () => {
    for (const evalCase of EVAL_CASES) {
      for (const req of evalCase.requirements) {
        if (!req.shouldMatch) {
          expect(req.expectedContentSubstring).toBeUndefined();
        }
      }
    }
  });

  it("contains a non-trivial mix of positive and negative examples", () => {
    const all = EVAL_CASES.flatMap((c) => c.requirements);
    const positives = all.filter((r) => r.shouldMatch).length;
    const negatives = all.filter((r) => !r.shouldMatch).length;
    expect(positives).toBeGreaterThan(3);
    expect(negatives).toBeGreaterThan(3);
  });
});

describe("runRetrievalEval", () => {
  it("runs without throwing and produces a well-formed report", () => {
    const report = runRetrievalEval();
    expect(report.perQuery.length).toBe(
      EVAL_CASES.flatMap((c) => c.requirements).length,
    );
    expect(report.ranking.recallAt1).toBeGreaterThanOrEqual(0);
    expect(report.ranking.recallAt1).toBeLessThanOrEqual(1);
    expect(report.classification.accuracy).toBeGreaterThanOrEqual(0);
    expect(report.classification.accuracy).toBeLessThanOrEqual(1);
  });

  it("regression floor: classification accuracy must not silently drop below 90% on this dataset", () => {
    // Pinned to the measured result after the Stage 4 fixes (BM25 stopword filtering,
    // weighted RRF, and a data-driven DENSE_MATCH_THRESHOLD). If a future change to
    // retrieval/matching logic drops below this, that's a real regression to
    // investigate — not a reason to just raise the number.
    const report = runRetrievalEval();
    expect(report.classification.accuracy).toBeGreaterThanOrEqual(0.9);
  });

  it("regression floor: Recall@3 must not silently drop below 90% on this dataset", () => {
    const report = runRetrievalEval();
    expect(report.ranking.recallAt3).toBeGreaterThanOrEqual(0.9);
  });
});
