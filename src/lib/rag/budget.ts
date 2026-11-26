/**
 * Dynamic context budgeting.
 *
 * Replaces the old `truncateForBudget(text, maxChars)` — which blindly cuts off
 * whatever comes after character N, frequently mid-sentence, and always discards the
 * *end* of the document regardless of what's there — with something that:
 *
 *   1. Measures against a real token budget (see tokenizer.ts), not a chars/N guess.
 *   2. When everything fits, changes nothing — every chunk is included, in original
 *      order. This matters: unlike a Q&A retrieval use case, most of this app's
 *      features (Analysis, Roadmap, Interview Prep, ...) need the *whole* resume to
 *      do a fair analysis, so this is a compression/prioritization strategy, not a
 *      "top-k retrieval" one.
 *   3. When it doesn't fit, drops or shrinks the lowest-priority *sections* first
 *      (Awards/Publications before Experience/Skills/Projects) instead of chopping
 *      off whatever happened to be physically last in the raw text — a resume that
 *      lists Certifications before Experience would otherwise lose its actual work
 *      history first under the old scheme, which is exactly backwards.
 *
 * The result is always re-assembled in original document order, so the LLM still
 * reads a normal-looking resume, just a compressed one when compression was needed.
 */
import { chunkResume, type ResumeChunk } from "./chunker";
import { detectSections, normalizeResumeText } from "./section-detector";
import { countTokens, truncateToTokenBudget } from "./tokenizer";

// Higher = more important to keep under pressure. Experience and Projects are what
// most analysis/scoring features actually weigh most heavily; Awards/Publications are
// the most commonly optional/decorative sections on a typical software-role resume.
const SECTION_PRIORITY: Record<string, number> = {
  experience: 100,
  projects: 90,
  skills: 85,
  summary: 70,
  education: 60,
  certifications: 50,
  awards: 30,
  publications: 30,
  other: 40,
};

export interface BudgetedContext {
  text: string;
  tokensUsed: number;
  tokenBudget: number;
  wasCompressed: boolean;
  includedChunkIds: string[];
  droppedChunkIds: string[];
}

/**
 * Fits `rawText` (assumed to be resume-shaped: headings + entries) into `tokenBudget`
 * tokens, preserving as much high-priority content as possible instead of just
 * cutting the tail.
 */
export function buildBudgetedResumeContext(
  rawText: string,
  tokenBudget: number,
): BudgetedContext {
  const normalized = normalizeResumeText(rawText || "");
  if (!normalized) {
    return {
      text: "",
      tokensUsed: 0,
      tokenBudget,
      wasCompressed: false,
      includedChunkIds: [],
      droppedChunkIds: [],
    };
  }

  const totalTokens = countTokens(normalized);
  if (totalTokens <= tokenBudget) {
    return {
      text: normalized,
      tokensUsed: totalTokens,
      tokenBudget,
      wasCompressed: false,
      includedChunkIds: [],
      droppedChunkIds: [],
    };
  }

  const sections = detectSections(normalized);
  const chunks = chunkResume(sections);

  // Greedily include chunks in priority order (ties broken by original document
  // order) until the budget is spent, reserving a small margin for join whitespace
  // and a trailing compression note.
  const RESERVE_TOKENS = 20;
  const effectiveBudget = Math.max(tokenBudget - RESERVE_TOKENS, 0);

  // Group into priority tiers (distinct priority values), each tier internally kept
  // in original document order. A tier is only touched once every higher tier has
  // been included *in full* — this is what actually guarantees "drop Awards before
  // Experience" rather than merely biasing toward it: a naive single-pass greedy
  // knapsack would happily use small leftover room to sneak in a low-priority chunk
  // while a higher-priority chunk still couldn't fit, which is the opposite of the
  // intended behavior.
  const tierMap = new Map<number, ResumeChunk[]>();
  for (const chunk of chunks) {
    const priority = SECTION_PRIORITY[chunk.section] ?? 40;
    const list = tierMap.get(priority) ?? [];
    list.push(chunk);
    tierMap.set(priority, list);
  }
  for (const list of tierMap.values()) {
    list.sort((a, b) => a.order - b.order || a.seq - b.seq);
  }
  const tiers = [...tierMap.entries()].sort((a, b) => b[0] - a[0]);

  const included = new Set<string>();
  let used = 0;
  tierLoop: for (const [, tierChunks] of tiers) {
    for (const chunk of tierChunks) {
      if (used + chunk.tokenCount > effectiveBudget) {
        break tierLoop;
      }
      included.add(chunk.id);
      used += chunk.tokenCount;
    }
  }

  // Guarantee forward progress: if even the single highest-priority chunk doesn't
  // fit (pathological case: one enormous chunk), truncate it to fit rather than
  // returning nothing.
  if (included.size === 0 && chunks.length > 0) {
    const first = tiers[0][1][0];
    const fitted = truncateToTokenBudget(first.content, effectiveBudget);
    return {
      text: fitted.text,
      tokensUsed: fitted.tokensUsed,
      tokenBudget,
      wasCompressed: true,
      includedChunkIds: [first.id],
      droppedChunkIds: chunks
        .filter((c) => c.id !== first.id)
        .map((c) => c.id),
    };
  }

  const includedChunks = chunks
    .filter((c) => included.has(c.id))
    .sort((a, b) => a.order - b.order || a.seq - b.seq);
  const droppedChunks = chunks.filter((c) => !included.has(c.id));

  let text = reassemble(includedChunks, droppedChunks.length > 0);
  let tokensUsed = countTokens(text);
  // The RESERVE_TOKENS margin above is sized for the drop-note's *typical* cost, not
  // an exact one — re-measuring here and clamping if needed makes the "never exceeds
  // tokenBudget" guarantee exact rather than approximate.
  if (tokensUsed > tokenBudget) {
    const clamped = truncateToTokenBudget(text, tokenBudget);
    text = clamped.text;
    tokensUsed = clamped.tokensUsed;
  }

  return {
    text,
    tokensUsed,
    tokenBudget,
    wasCompressed: true,
    includedChunkIds: includedChunks.map((c) => c.id),
    droppedChunkIds: droppedChunks.map((c) => c.id),
  };
}

function reassemble(chunks: ResumeChunk[], notedDrops: boolean): string {
  const bySection: Map<string, ResumeChunk[]> = new Map();
  for (const chunk of chunks) {
    const key = `${chunk.order}::${chunk.heading}`;
    const list = bySection.get(key) ?? [];
    list.push(chunk);
    bySection.set(key, list);
  }

  const parts: string[] = [];
  for (const [key, group] of bySection) {
    const heading = key.split("::")[1];
    parts.push(`${heading}\n${group.map((c) => c.content).join("\n\n")}`);
  }

  let text = parts.join("\n\n");
  if (notedDrops) {
    text += "\n\n…[lower-priority sections omitted to stay within request limits]";
  }
  return text;
}
