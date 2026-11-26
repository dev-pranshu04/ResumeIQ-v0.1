/**
 * Semantic chunking + metadata generation.
 *
 * Turns each ResumeSection into one or more chunks, split by *idea* (one job, one
 * project, one degree) rather than by a fixed character count. A fixed-size splitter
 * can cut a bullet point in half or merge two unrelated jobs into one chunk, both of
 * which hurt embedding quality and retrieval precision downstream. Splitting on blank
 * lines / entry boundaries keeps each chunk topically coherent.
 *
 * Sections that are naturally atomic (Skills, Summary) are kept as a single chunk —
 * splitting "Skills" further would just fragment a list with no topical boundary to
 * split on.
 */
import { countTokens } from "./tokenizer";
import type { ResumeSection, SectionKind } from "./section-detector";

export interface ResumeChunk {
  id: string;
  /**
   * Numeric document-order sequence number, distinct from `order` (which is shared by
   * every chunk within the same section). Use this — not string-comparing `id` — to
   * sort chunks back into reading order, since "chunk_10" sorts before "chunk_2"
   * lexicographically.
   */
  seq: number;
  section: SectionKind;
  heading: string;
  /** Short human-readable label for this specific chunk, e.g. a job title or project name. */
  title: string;
  content: string;
  tokenCount: number;
  /** Order within the source document, used to preserve reading order when re-assembling. */
  order: number;
}

const ATOMIC_SECTIONS: SectionKind[] = ["skills", "summary"];

/** First non-empty line of an entry, truncated, used as a display title for the chunk. */
function deriveTitle(entryText: string, fallback: string): string {
  const firstLine = entryText.split("\n").find((l) => l.trim().length > 0);
  if (!firstLine) return fallback;
  const cleaned = firstLine.trim().replace(/^[-•*]\s*/, "");
  return cleaned.length > 80 ? `${cleaned.slice(0, 77)}...` : cleaned;
}

/**
 * Splits a section's content into entries on blank-line boundaries. Consecutive
 * bullet lines under the same un-blank-separated block stay together (they're
 * sub-points of one entry, e.g. bullets under one job).
 */
function splitIntoEntries(content: string): string[] {
  const blocks = content
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter(Boolean);
  return blocks.length > 0 ? blocks : [content.trim()];
}

export function chunkSection(
  section: ResumeSection,
  chunkIndexStart: number,
): ResumeChunk[] {
  const chunks: ResumeChunk[] = [];
  let idx = chunkIndexStart;

  if (ATOMIC_SECTIONS.includes(section.kind)) {
    idx += 1;
    chunks.push({
      id: `chunk_${idx}`,
      seq: idx,
      section: section.kind,
      heading: section.heading,
      title: section.heading,
      content: section.content,
      tokenCount: countTokens(section.content),
      order: section.order,
    });
    return chunks;
  }

  const entries = splitIntoEntries(section.content);
  for (const entry of entries) {
    idx += 1;
    chunks.push({
      id: `chunk_${idx}`,
      seq: idx,
      section: section.kind,
      heading: section.heading,
      title: deriveTitle(entry, section.heading),
      content: entry,
      tokenCount: countTokens(entry),
      order: section.order,
    });
  }
  return chunks;
}

/** Chunks every section of a resume into an ordered, ID-stable flat list. */
export function chunkResume(sections: ResumeSection[]): ResumeChunk[] {
  const chunks: ResumeChunk[] = [];
  let idx = 0;
  for (const section of sections) {
    const sectionChunks = chunkSection(section, idx);
    chunks.push(...sectionChunks);
    idx += sectionChunks.length;
  }
  return chunks;
}
