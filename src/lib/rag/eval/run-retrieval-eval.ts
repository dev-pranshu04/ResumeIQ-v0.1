/**
 * Runs EVAL_CASES through the actual retrieval pipeline (chunker + HybridRetriever +
 * buildRequirementEvidence — the same code paths JD Matcher uses in production, not a
 * separate test-only implementation) and computes ranking + classification metrics.
 */
import { chunkResume, type ResumeChunk } from "../chunker";
import { detectSections, normalizeResumeText } from "../section-detector";
import { HybridRetriever } from "../hybrid-retriever";
import { buildRequirementEvidence } from "../jd-evidence";
import { EVAL_CASES, type EvalCase } from "./dataset";
import {
  classificationMetrics,
  meanReciprocalRank,
  ndcgAtK,
  recallAtK,
  type ClassificationMetrics,
} from "./metrics";

export interface PerQueryResult {
  case: string;
  requirement: string;
  shouldMatch: boolean;
  predictedMatch: boolean;
  goldRank: number | null;
  latencyMs: number;
}

export interface RetrievalEvalReport {
  perQuery: PerQueryResult[];
  ranking: {
    recallAt1: number;
    recallAt3: number;
    recallAt5: number;
    mrr: number;
    ndcgAt5: number;
    /** Number of shouldMatch:true queries actually used for ranking metrics. */
    queriesEvaluated: number;
  };
  classification: ClassificationMetrics;
  avgLatencyMs: number;
}

function findGoldChunkId(
  chunks: ResumeChunk[],
  expectedContentSubstring: string,
): string | null {
  const match = chunks.find((c) => c.content.includes(expectedContentSubstring));
  return match?.id ?? null;
}

export function runRetrievalEval(cases: EvalCase[] = EVAL_CASES): RetrievalEvalReport {
  const perQuery: PerQueryResult[] = [];
  const goldRanks: Array<number | null> = [];
  const predicted: boolean[] = [];
  const expected: boolean[] = [];

  for (const evalCase of cases) {
    const normalized = normalizeResumeText(evalCase.resume);
    const sections = detectSections(normalized);
    const chunks = chunkResume(sections);
    const retriever = new HybridRetriever(chunks);

    for (const req of evalCase.requirements) {
      const start = performance.now();
      const ranked = retriever.search(req.requirement, chunks.length);
      const latencyMs = performance.now() - start;

      let goldRank: number | null = null;
      if (req.shouldMatch && req.expectedContentSubstring) {
        const goldId = findGoldChunkId(chunks, req.expectedContentSubstring);
        if (goldId) {
          const idx = ranked.findIndex((r) => r.chunk.id === goldId);
          goldRank = idx === -1 ? null : idx;
        }
        goldRanks.push(goldRank);
      }

      // Use the real per-requirement classification path (buildRequirementEvidence)
      // against this exact requirement string, rather than re-deriving a match
      // decision here — this evaluates the actual production code path.
      const evidenceForReq = buildRequirementEvidence(
        evalCase.resume,
        req.requirement,
      );
      const predictedMatch = evidenceForReq[0]?.matched ?? false;
      predicted.push(predictedMatch);
      expected.push(req.shouldMatch);

      perQuery.push({
        case: evalCase.name,
        requirement: req.requirement,
        shouldMatch: req.shouldMatch,
        predictedMatch,
        goldRank,
        latencyMs,
      });
    }
  }

  const avgLatencyMs =
    perQuery.reduce((sum, q) => sum + q.latencyMs, 0) / (perQuery.length || 1);

  return {
    perQuery,
    ranking: {
      recallAt1: recallAtK(goldRanks, 1),
      recallAt3: recallAtK(goldRanks, 3),
      recallAt5: recallAtK(goldRanks, 5),
      mrr: meanReciprocalRank(goldRanks),
      ndcgAt5: ndcgAtK(goldRanks, 5),
      queriesEvaluated: goldRanks.length,
    },
    classification: classificationMetrics(predicted, expected),
    avgLatencyMs,
  };
}
