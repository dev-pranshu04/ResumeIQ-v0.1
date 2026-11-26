/**
 * BM25 lexical scoring — the standard probabilistic ranking function behind classic
 * search engines, used here as the "sparse" half of hybrid retrieval alongside the
 * hashed embeddings in embeddings.ts. A resume's chunk corpus is small (a few dozen
 * chunks at most), so this runs the full computation per query with no indexing
 * infrastructure needed.
 */

const K1 = 1.5; // term-frequency saturation
const B = 0.75; // length-normalization strength

// Standard English stopwords, plus a handful of words so generic to job-description/
// resume phrasing specifically ("experience", "role", "years", "strong") that they
// carry near-zero discriminating signal in this domain even though they aren't on a
// general-purpose stopword list. Without this, a requirement like "Experience with
// mobile app development" can register nonzero BM25 overlap against a completely
// unrelated resume chunk purely through shared function words like "with" — which is
// exactly the false-positive pattern the evaluation harness (scripts/eval.ts) caught.
const STOPWORDS = new Set([
  "a", "an", "the", "and", "or", "of", "in", "on", "at", "to", "for", "with",
  "using", "is", "are", "was", "were", "be", "been", "being", "as", "by",
  "this", "that", "these", "those", "it", "its", "from", "into", "than",
  "then", "so", "such", "not", "no", "but", "if", "will", "can", "may",
  "experience", "experienced", "role", "years", "year", "strong", "excellent",
  "including", "etc", "you", "your", "our", "we",
]);

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9+#.]+/g, " ")
    .split(" ")
    .filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

export interface Bm25Document {
  id: string;
  text: string;
}

interface IndexedDocument {
  id: string;
  termCounts: Map<string, number>;
  length: number;
}

export class Bm25Index {
  private docs: IndexedDocument[];
  private avgDocLength: number;
  private docFreq: Map<string, number>;
  private readonly n: number;

  constructor(documents: Bm25Document[]) {
    this.docs = documents.map((d) => {
      const tokens = tokenize(d.text);
      const termCounts = new Map<string, number>();
      for (const t of tokens) termCounts.set(t, (termCounts.get(t) ?? 0) + 1);
      return { id: d.id, termCounts, length: tokens.length };
    });
    this.n = this.docs.length;
    this.avgDocLength =
      this.n === 0
        ? 0
        : this.docs.reduce((sum, d) => sum + d.length, 0) / this.n;

    this.docFreq = new Map();
    for (const doc of this.docs) {
      for (const term of doc.termCounts.keys()) {
        this.docFreq.set(term, (this.docFreq.get(term) ?? 0) + 1);
      }
    }
  }

  private idf(term: string): number {
    const df = this.docFreq.get(term) ?? 0;
    // Standard BM25 idf with a +1 floor so unseen query terms score 0 rather than
    // negative (which the classic Robertson-Spärck Jones formula can produce for
    // terms appearing in more than half the corpus — irrelevant at this corpus size,
    // but cheap to guard against).
    return Math.max(
      0,
      Math.log((this.n - df + 0.5) / (df + 0.5) + 1),
    );
  }

  /** Scores and ranks every document against `query`, highest score first. */
  search(query: string): Array<{ id: string; score: number }> {
    const queryTerms = tokenize(query);
    if (this.n === 0 || queryTerms.length === 0) {
      return this.docs.map((d) => ({ id: d.id, score: 0 }));
    }

    return this.docs
      .map((doc) => {
        let score = 0;
        for (const term of queryTerms) {
          const tf = doc.termCounts.get(term) ?? 0;
          if (tf === 0) continue;
          const idf = this.idf(term);
          const numerator = tf * (K1 + 1);
          const denominator =
            tf + K1 * (1 - B + (B * doc.length) / (this.avgDocLength || 1));
          score += idf * (numerator / denominator);
        }
        return { id: doc.id, score };
      })
      .sort((a, b) => b.score - a.score);
  }
}
