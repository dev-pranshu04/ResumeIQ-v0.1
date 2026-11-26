/**
 * Standard retrieval evaluation metrics, computed over 0-indexed ranks of the "gold"
 * (known-correct) result for each query. Each query here contributes exactly one
 * relevant item (a JD requirement has one best-supporting resume chunk in the eval
 * dataset), which keeps the formulas simple binary-relevance versions of the general
 * ones — documented per function.
 */

/**
 * Recall@k: fraction of queries where the gold item appears within the top k results.
 * `ranks` are 0-indexed positions of the gold item in each query's ranked results, or
 * `null` if the gold item wasn't returned at all (e.g. retrieved list shorter than the
 * corpus for some reason).
 */
export function recallAtK(ranks: Array<number | null>, k: number): number {
  if (ranks.length === 0) return 0;
  const hits = ranks.filter((r) => r !== null && r < k).length;
  return hits / ranks.length;
}

/**
 * Mean Reciprocal Rank: average of 1/(rank+1) across queries — rewards finding the
 * gold item early, with sharply diminishing credit the further down it appears.
 */
export function meanReciprocalRank(ranks: Array<number | null>): number {
  if (ranks.length === 0) return 0;
  const reciprocals = ranks.map((r) => (r === null ? 0 : 1 / (r + 1)));
  return reciprocals.reduce((sum, v) => sum + v, 0) / reciprocals.length;
}

/**
 * NDCG@k for single-relevant-item queries: DCG@k = 1/log2(rank+2) if the gold item is
 * within the top k, else 0. IDCG@k (best possible: gold item at rank 0) = 1/log2(2) = 1,
 * so NDCG@k reduces to DCG@k directly. Averaged across queries.
 */
export function ndcgAtK(ranks: Array<number | null>, k: number): number {
  if (ranks.length === 0) return 0;
  const scores = ranks.map((r) => {
    if (r === null || r >= k) return 0;
    return 1 / Math.log2(r + 2);
  });
  return scores.reduce((sum, v) => sum + v, 0) / scores.length;
}

export interface ClassificationCounts {
  truePositive: number;
  trueNegative: number;
  falsePositive: number;
  falseNegative: number;
}

export interface ClassificationMetrics extends ClassificationCounts {
  accuracy: number;
  precision: number;
  recall: number;
  f1: number;
}

/**
 * Precision/recall/F1/accuracy for a binary matched/unmatched classifier, given
 * predicted vs expected booleans for the same set of queries.
 */
export function classificationMetrics(
  predicted: boolean[],
  expected: boolean[],
): ClassificationMetrics {
  const counts: ClassificationCounts = {
    truePositive: 0,
    trueNegative: 0,
    falsePositive: 0,
    falseNegative: 0,
  };
  for (let i = 0; i < predicted.length; i++) {
    const p = predicted[i];
    const e = expected[i];
    if (p && e) counts.truePositive += 1;
    else if (!p && !e) counts.trueNegative += 1;
    else if (p && !e) counts.falsePositive += 1;
    else counts.falseNegative += 1;
  }
  const total = predicted.length || 1;
  const precisionDenom = counts.truePositive + counts.falsePositive;
  const recallDenom = counts.truePositive + counts.falseNegative;
  const precision = precisionDenom === 0 ? 1 : counts.truePositive / precisionDenom;
  const recall = recallDenom === 0 ? 1 : counts.truePositive / recallDenom;
  const f1 =
    precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
  return {
    ...counts,
    accuracy: (counts.truePositive + counts.trueNegative) / total,
    precision,
    recall,
    f1,
  };
}
