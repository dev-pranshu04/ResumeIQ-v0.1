/**
 * Resume normalization + section detection.
 *
 * Resumes come out of the parser as one flat block of text. This module splits that
 * block into labeled sections (Experience, Projects, Skills, Education, ...) using a
 * heading-recognition pass, so downstream code (chunker, budget manager, JD matcher)
 * can reason about "the Projects section" instead of an undifferentiated blob.
 *
 * This is deliberately regex/heuristic-based rather than an LLM call: it needs to run
 * on every request, for free, in a few milliseconds, and resume headings are one of
 * the most standardized conventions in any document type — a small alias table covers
 * the overwhelming majority of real resumes without spending a model call on it.
 */

export type SectionKind =
  | "summary"
  | "experience"
  | "projects"
  | "skills"
  | "education"
  | "certifications"
  | "awards"
  | "publications"
  | "other";

export interface ResumeSection {
  kind: SectionKind;
  heading: string;
  content: string;
  /** 1-based order the section appeared in the source document. */
  order: number;
}

// Canonical heading -> section kind. Matched case-insensitively against a normalized
// (whitespace-collapsed, punctuation-stripped) heading line. Ordered roughly by how
// often a given phrase collides with a shorter alias (longest/most-specific first
// within each kind isn't required here since we match on exact normalized equality).
const HEADING_ALIASES: Record<string, SectionKind> = {
  summary: "summary",
  "professional summary": "summary",
  "career summary": "summary",
  profile: "summary",
  objective: "summary",
  "career objective": "summary",
  about: "summary",

  experience: "experience",
  "work experience": "experience",
  "professional experience": "experience",
  "employment history": "experience",
  employment: "experience",
  "work history": "experience",

  projects: "projects",
  "personal projects": "projects",
  "academic projects": "projects",
  "side projects": "projects",
  portfolio: "projects",

  skills: "skills",
  "technical skills": "skills",
  "skills summary": "skills",
  "core competencies": "skills",
  competencies: "skills",
  "tools and technologies": "skills",

  education: "education",
  "academic background": "education",

  certifications: "certifications",
  certificates: "certifications",
  "licenses and certifications": "certifications",

  awards: "awards",
  honors: "awards",
  "awards and honors": "awards",
  achievements: "awards",

  publications: "publications",
  research: "publications",
};

const MAX_HEADING_LINE_LENGTH = 60;

function normalizeHeadingCandidate(line: string): string {
  return line
    .trim()
    .toLowerCase()
    .replace(/[:•\-–—]+$/g, "")
    .replace(/[^a-z0-9 &]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Heuristics for "this line is probably a heading, not body text": short, not ending
 * in a sentence-terminal period, and either ALL CAPS or Title Case with no lowercase
 * connective words that indicate a normal sentence.
 */
function looksLikeHeadingLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed || trimmed.length > MAX_HEADING_LINE_LENGTH) return false;
  if (/[.!?]$/.test(trimmed)) return false;
  const wordCount = trimmed.split(/\s+/).length;
  if (wordCount > 6) return false;
  const isAllCaps = trimmed === trimmed.toUpperCase() && /[A-Z]/.test(trimmed);
  const isTitleOrKnown =
    normalizeHeadingCandidate(trimmed) in HEADING_ALIASES;
  return isAllCaps || isTitleOrKnown;
}

/** Normalizes raw parser output: collapses excess blank lines and stray whitespace. */
export function normalizeResumeText(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * Splits normalized resume text into sections. Any content before the first detected
 * heading (name, contact info, or an un-headed intro) is kept as a "summary" section
 * so nothing is silently dropped. If no headings are detected at all, the whole
 * document comes back as a single "other" section — callers must handle that case
 * (it means the resume uses non-standard formatting, which is itself useful signal).
 */
export function detectSections(normalizedText: string): ResumeSection[] {
  const lines = normalizedText.split("\n");
  const sections: ResumeSection[] = [];
  let currentKind: SectionKind = "summary";
  let currentHeading = "Header";
  let buffer: string[] = [];
  let order = 0;

  const flush = () => {
    const content = buffer.join("\n").trim();
    if (content) {
      order += 1;
      sections.push({ kind: currentKind, heading: currentHeading, content, order });
    }
    buffer = [];
  };

  for (const line of lines) {
    if (looksLikeHeadingLine(line)) {
      const normalized = normalizeHeadingCandidate(line);
      const kind = HEADING_ALIASES[normalized];
      if (kind) {
        flush();
        currentKind = kind;
        currentHeading = line.trim();
        continue;
      }
    }
    buffer.push(line);
  }
  flush();

  if (sections.length === 0 && normalizedText) {
    sections.push({
      kind: "other",
      heading: "Resume",
      content: normalizedText,
      order: 1,
    });
  }

  return sections;
}
