import { describe, expect, it } from "vitest";
import {
  classificationMetrics,
  meanReciprocalRank,
  ndcgAtK,
  recallAtK,
} from "./metrics";

describe("recallAtK", () => {
  it("is 1.0 when the gold item is always within k", () => {
    expect(recallAtK([0, 1, 2], 3)).toBe(1);
  });

  it("is 0.5 when half the gold items fall outside k", () => {
    expect(recallAtK([0, 5], 1)).toBe(0.5);
  });

  it("treats null (gold item never retrieved) as a miss", () => {
    expect(recallAtK([0, null], 1)).toBe(0.5);
  });

  it("returns 0 for an empty input", () => {
    expect(recallAtK([], 3)).toBe(0);
  });
});

describe("meanReciprocalRank", () => {
  it("is 1.0 when every gold item is rank 0", () => {
    expect(meanReciprocalRank([0, 0, 0])).toBe(1);
  });

  it("averages reciprocal ranks correctly", () => {
    // 1/1 + 1/2 = 1.5, / 2 = 0.75
    expect(meanReciprocalRank([0, 1])).toBeCloseTo(0.75, 5);
  });

  it("treats null as contributing 0", () => {
    expect(meanReciprocalRank([0, null])).toBeCloseTo(0.5, 5);
  });
});

describe("ndcgAtK", () => {
  it("is 1.0 when every gold item is rank 0 within k", () => {
    expect(ndcgAtK([0, 0], 5)).toBeCloseTo(1, 5);
  });

  it("is 0 when the gold item falls outside k", () => {
    expect(ndcgAtK([10], 5)).toBe(0);
  });

  it("gives partial credit for a gold item ranked below 0 but within k", () => {
    const score = ndcgAtK([1], 5);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });
});

describe("classificationMetrics", () => {
  it("computes a perfect score for perfect predictions", () => {
    const m = classificationMetrics([true, false, true], [true, false, true]);
    expect(m.accuracy).toBe(1);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
    expect(m.f1).toBe(1);
  });

  it("correctly counts false positives and false negatives", () => {
    const m = classificationMetrics(
      [true, true, false, false],
      [true, false, true, false],
    );
    expect(m.truePositive).toBe(1);
    expect(m.trueNegative).toBe(1);
    expect(m.falsePositive).toBe(1);
    expect(m.falseNegative).toBe(1);
    expect(m.accuracy).toBe(0.5);
  });

  it("does not divide by zero when there are no positive predictions", () => {
    const m = classificationMetrics([false, false], [false, false]);
    expect(m.precision).toBe(1);
    expect(m.recall).toBe(1);
  });
});
