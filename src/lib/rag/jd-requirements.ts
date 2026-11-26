/**
 * Splits a job description into individual candidate requirement statements — one
 * retrieval query per line/bullet/sentence, rather than treating the whole JD as one
 * blob. Deliberately heuristic/deterministic rather than an LLM call: it needs to run
 * for free, instantly, on every request, and job postings are formatted consistently
 * enough (bullet lists, short requirement sentences) that line/sentence splitting
 * plus basic noise filtering captures the useful signal without spending a model call
 * on it.
 */

const MIN_REQUIREMENT_LENGTH = 12;
const MAX_REQUIREMENT_LENGTH = 240;
const MAX_REQUIREMENTS = 15;

// Lines that are almost never real requirements even if they're the right length —
// boilerplate section headers and legal/EEO text common in job postings.
const NOISE_PATTERNS = [
  /^(about|who we are|our company|benefits|perks|compensation|salary|equal opportunity|eeo)/i,
  /^(apply|how to apply|application process)/i,
  /^\s*(job type|location|department)\s*:/i,
];

function splitCandidateLines(text: string): string[] {
  // First split on line breaks (bullet lists are the common case); any resulting
  // line still longer than a couple of sentences gets further split on sentence
  // boundaries, so a JD written as prose paragraphs still yields granular queries.
  const lines = text
    .split(/\n+/)
    .map((l) => l.replace(/^[-•*\u2022]\s*/, "").trim())
    .filter(Boolean);

  const candidates: string[] = [];
  for (const line of lines) {
    if (line.length <= MAX_REQUIREMENT_LENGTH) {
      candidates.push(line);
    } else {
      const sentences = line.split(/(?<=[.!?])\s+/).map((s) => s.trim());
      candidates.push(...sentences.filter(Boolean));
    }
  }
  return candidates;
}

/**
 * Extracts up to MAX_REQUIREMENTS distinct requirement-like statements from a job
 * description, longest-first (a proxy for specificity — very short lines tend to be
 * headers or filler, not concrete requirements).
 */
export function extractRequirements(jobDescription: string): string[] {
  const candidates = splitCandidateLines(jobDescription);
  const seen = new Set<string>();
  const filtered: string[] = [];

  for (const candidate of candidates) {
    if (candidate.length < MIN_REQUIREMENT_LENGTH) continue;
    if (NOISE_PATTERNS.some((p) => p.test(candidate))) continue;
    const key = candidate.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    filtered.push(candidate);
  }

  return filtered
    .sort((a, b) => b.length - a.length)
    .slice(0, MAX_REQUIREMENTS);
}
