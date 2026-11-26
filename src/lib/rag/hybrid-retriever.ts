/**
 * Hybrid retrieval: combines dense (hashed-embedding cosine similarity) and sparse
 * (BM25) rankings via Reciprocal Rank Fusion (RRF), rather than trusting either
 * signal alone. Dense and lexical retrieval fail in different, complementary ways —
 * dense catches paraphrase/fuzzy matches BM25 misses, BM25 catches exact
 * acronym/tool-name matches a hashed vector can dilute — so fusing their *rankings*
 * (not raw scores, which live on incomparable scales) is the standard way to get the
 * benefit of both.
 */
import { Bm25Index } from "./bm25";
import { cosineSimilarity, embedCached } from "./embeddings";
import type { ResumeChunk } from "./chunker";

const RRF_K = 60; // standard RRF damping constant from the original paper
// The two signals here aren't equally trustworthy: BM25 is exact token-overlap math,
// while the dense signal is a noisy hashed (non-neural) embedding — see the tradeoff
// documented in embeddings.ts. Unweighted RRF let a chunk the dense signal ranked #1
// purely from shared short/common substrings produce a near-tie with the chunk the
// lexical signal correctly ranked #1 via genuine term overlap; weighting lexical
// higher reflects which signal actually deserves more trust in this design.
const LEXICAL_WEIGHT = 1.5;
const DENSE_WEIGHT = 1.0;

export interface RetrievedChunk {
  chunk: ResumeChunk;
  denseScore: number;
  lexicalScore: number;
  lexicalRank: number;
  denseRank: number;
  combinedScore: number;
}

export class HybridRetriever {
  private readonly chunks: ResumeChunk[];
  private readonly bm25: Bm25Index;
  private readonly chunkVectors: Map<string, number[]>;

  constructor(chunks: ResumeChunk[]) {
    this.chunks = chunks;
    this.bm25 = new Bm25Index(chunks.map((c) => ({ id: c.id, text: c.content })));
    this.chunkVectors = new Map(
      chunks.map((c) => [c.id, embedCached(c.content)]),
    );
  }

  /** Retrieves the top `limit` chunks for `query`, ranked by fused dense+lexical rank. */
  search(query: string, limit = 3): RetrievedChunk[] {
    if (this.chunks.length === 0) return [];

    const queryVector = embedCached(query);
    const denseRanked = [...this.chunks]
      .map((c) => ({
        id: c.id,
        score: cosineSimilarity(queryVector, this.chunkVectors.get(c.id) ?? []),
      }))
      .sort((a, b) => b.score - a.score);

    const lexicalRanked = this.bm25.search(query);

    const denseRankById = new Map(denseRanked.map((d, i) => [d.id, i]));
    const lexicalRankById = new Map(lexicalRanked.map((d, i) => [d.id, i]));
    const denseScoreById = new Map(denseRanked.map((d) => [d.id, d.score]));
    const lexicalScoreById = new Map(lexicalRanked.map((d) => [d.id, d.score]));

    const fused = this.chunks.map((chunk) => {
      const denseRank = denseRankById.get(chunk.id) ?? this.chunks.length;
      const lexicalRank = lexicalRankById.get(chunk.id) ?? this.chunks.length;
      // Weighted RRF: sum of weight/(k + rank) across both rankings. Using ranks
      // instead of raw scores is what makes this valid to combine at all — BM25
      // scores and cosine similarities aren't on comparable scales, but ranks
      // always are. The weights (see constants above) reflect that the lexical
      // signal is more trustworthy than the hashed dense signal in this design.
      const combinedScore =
        (DENSE_WEIGHT * 1) / (RRF_K + denseRank + 1) +
        (LEXICAL_WEIGHT * 1) / (RRF_K + lexicalRank + 1);
      return {
        chunk,
        denseScore: denseScoreById.get(chunk.id) ?? 0,
        lexicalScore: lexicalScoreById.get(chunk.id) ?? 0,
        denseRank,
        lexicalRank,
        combinedScore,
      };
    });

    return fused
      .sort((a, b) => b.combinedScore - a.combinedScore)
      .slice(0, limit);
  }
}
