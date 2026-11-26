/**
 * Ties chunking + hybrid retrieval + requirement extraction together: given a resume
 * and a job description, produces one evidence record per JD requirement, each citing
 * the resume chunk(s) that best support it along with a measured similarity score.
 *
 * This is the one place in the app where real per-query retrieval is the right tool
 * (see ENGINEERING_NOTES.md) — everywhere else, the whole resume is needed for a fair
 * analysis, so retrieval-that-discards would hurt rather than help.
 */
import { chunkResume } from "./chunker";
import { detectSections, normalizeResumeText } from "./section-detector";
import { HybridRetriever } from "./hybrid-retriever";
import { extractRequirements } from "./jd-requirements";

export interface RequirementEvidence {
  requirement: string;
  matched: boolean;
  bestChunkTitle: string | null;
  bestChunkSection: string | null;
  /** 0-100, derived from the fused dense+lexical retrieval score. */
  similarityScore: number;
  snippet: string | null;
}

// "matched" requires real evidence, not just "ranked highest among a handful of
// candidates" (which RRF's top pick always satisfies trivially, even for a
// completely irrelevant requirement, at the small per-resume corpus sizes this runs
// against). Two independent signals, either sufficient on its own:
//   - genuine lexical term overlap (BM25 score > 0): the requirement and the resume
//     chunk share real, IDF-weighted vocabulary — the strongest, least noisy signal.
//   - a high dense-similarity score: catches paraphrases with zero literal word
//     overlap, but needs a stricter bar than lexical, because short-text hashed
//     embeddings can show moderate spurious similarity from shared stopwords alone.
// Threshold set from measured data (scripts/eval.ts / src/lib/rag/eval/dataset.ts):
// every genuine match in the eval dataset has real lexical overlap once BM25
// stopword-filters generic words (see bm25.ts), so this fallback exists only for a
// genuine paraphrase-with-zero-shared-vocabulary case, which needs a much higher bar
// than "somewhat similar" — the highest false-positive dense score observed in the
// eval dataset was 0.351 (an unrelated "graphic design" requirement against a backend
// engineer resume), so 0.55 leaves real margin rather than just scraping past it.
const DENSE_MATCH_THRESHOLD = 0.55;
const SNIPPET_MAX_CHARS = 220;

function toSnippet(content: string): string {
  const singleLine = content.replace(/\s+/g, " ").trim();
  return singleLine.length > SNIPPET_MAX_CHARS
    ? `${singleLine.slice(0, SNIPPET_MAX_CHARS - 1)}…`
    : singleLine;
}

/**
 * Normalizes a raw RRF combinedScore (theoretical max ~2/RRF_K, in practice much
 * smaller) onto a 0-100 display scale using the best score actually observed across
 * this resume's requirements, so scores stay meaningfully spread out regardless of
 * document length rather than all clustering near 0 (which the raw RRF formula would
 * do, since it's designed for ranking, not absolute magnitude).
 */
function toDisplayScore(rawScore: number, maxObserved: number): number {
  if (maxObserved <= 0) return 0;
  return Math.round(Math.min(1, rawScore / maxObserved) * 100);
}

export function buildRequirementEvidence(
  resumeText: string,
  jobDescription: string,
): RequirementEvidence[] {
  const normalized = normalizeResumeText(resumeText);
  const sections = detectSections(normalized);
  const chunks = chunkResume(sections);
  const requirements = extractRequirements(jobDescription);

  if (chunks.length === 0 || requirements.length === 0) return [];

  const retriever = new HybridRetriever(chunks);

  const rawResults = requirements.map((requirement) => {
    const [top] = retriever.search(requirement, 1);
    return { requirement, top };
  });

  const maxObserved = Math.max(
    0,
    ...rawResults.map((r) => r.top?.combinedScore ?? 0),
  );

  return rawResults.map(({ requirement, top }) => {
    if (!top) {
      return {
        requirement,
        matched: false,
        bestChunkTitle: null,
        bestChunkSection: null,
        similarityScore: 0,
        snippet: null,
      };
    }
    const matched = top.lexicalScore > 0 || top.denseScore >= DENSE_MATCH_THRESHOLD;
    return {
      requirement,
      matched,
      bestChunkTitle: matched ? top.chunk.title : null,
      bestChunkSection: matched ? top.chunk.section : null,
      similarityScore: toDisplayScore(top.combinedScore, maxObserved),
      snippet: matched ? toSnippet(top.chunk.content) : null,
    };
  });
}
