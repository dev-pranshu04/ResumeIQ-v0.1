/**
 * Local, zero-dependency embeddings via character n-gram feature hashing.
 *
 * This is deliberately NOT a neural embedding model (e.g. MiniLM/BERT-family). A real
 * transformer embedding would need model weights downloaded from a hub (HuggingFace)
 * at runtime, which on a serverless platform means every cold start either re-downloads
 * ~25MB before it can serve a request, or requires bundling the weights into the
 * deployment artifact. Neither is a good tradeoff for a project whose top priority is
 * "reliably works the moment a recruiter clicks a link" over marginal retrieval-quality
 * gains — so this uses the "hashing trick" (the same idea behind scikit-learn's
 * HashingVectorizer / Vowpal Wabbit): hash overlapping character n-grams into a
 * fixed-size vector, weight by frequency, L2-normalize. It's a real, well-established
 * technique for turning text into a comparable vector with zero network calls, zero
 * model files, and effectively instant cold start — and because it hashes character
 * n-grams (not whole tokens), it still captures partial matches BM25 alone would miss
 * (e.g. "Postgres" and "PostgreSQL" share most of their trigrams).
 *
 * If a future iteration wants a true neural embedding (e.g. once the deploy target can
 * bundle model weights), only this file's `embed()` function needs to change — every
 * caller works against the same `number[]` vector interface.
 */

const VECTOR_DIM = 256;
const NGRAM_SIZE = 3;

function normalizeForEmbedding(text: string): string {
  return text.toLowerCase().replace(/\s+/g, " ").trim();
}

/** FNV-1a string hash, consistent with the rest of the codebase's hashKey approach. */
function fnv1a(str: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function charNgrams(text: string, n: number): string[] {
  const padded = `_${text}_`;
  if (padded.length < n) return [padded];
  const grams: string[] = [];
  for (let i = 0; i <= padded.length - n; i++) {
    grams.push(padded.slice(i, i + n));
  }
  return grams;
}

/**
 * Embeds text into a fixed-length, L2-normalized vector. Deterministic: the same text
 * always produces the same vector, which is what makes the SHA256-keyed cache in
 * `embedChunksCached` valid.
 */
export function embed(text: string): number[] {
  const vector = new Array<number>(VECTOR_DIM).fill(0);
  const normalized = normalizeForEmbedding(text);
  if (!normalized) return vector;

  // Word-level unigrams alongside character n-grams: words carry exact-token signal
  // (useful for acronyms like "AWS"), n-grams carry fuzzy/partial-match signal
  // (useful for spelling/casing variants of the same skill name).
  const words = normalized
    .split(" ")
    .map((w) => w.replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, ""))
    .filter(Boolean);
  for (const word of words) {
    const idx = fnv1a(`w:${word}`) % VECTOR_DIM;
    vector[idx] += 1;
    for (const gram of charNgrams(word, NGRAM_SIZE)) {
      const gramIdx = fnv1a(`g:${gram}`) % VECTOR_DIM;
      vector[gramIdx] += 0.5;
    }
  }

  const norm = Math.sqrt(vector.reduce((sum, v) => sum + v * v, 0));
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

/** Cosine similarity between two equal-length, already-normalized vectors. */
export function cosineSimilarity(a: number[], b: number[]): number {
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  // Vectors from embed() are already unit-length, so the dot product IS the cosine
  // similarity — this clamp only guards against float drift pushing slightly past 1.
  return Math.max(-1, Math.min(1, dot));
}

/**
 * Best-effort, in-memory, per-server-instance embedding cache keyed by exact text
 * content. Mirrors the existing resultCache pattern in server-functions.ts (bounded
 * size, oldest-first eviction) so a resume re-analyzed within the same warm instance
 * doesn't recompute embeddings for unchanged chunks.
 */
const EMBEDDING_CACHE_MAX_ENTRIES = 1000;
const embeddingCache = new Map<string, number[]>();

export function embedCached(text: string): number[] {
  const cached = embeddingCache.get(text);
  if (cached) return cached;
  const vector = embed(text);
  embeddingCache.set(text, vector);
  if (embeddingCache.size > EMBEDDING_CACHE_MAX_ENTRIES) {
    const oldestKey = embeddingCache.keys().next().value;
    if (oldestKey !== undefined) embeddingCache.delete(oldestKey);
  }
  return vector;
}
