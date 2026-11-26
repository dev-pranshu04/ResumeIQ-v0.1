import { describe, expect, it } from "vitest";
import { detectSections, normalizeResumeText } from "./section-detector";

const SAMPLE_RESUME = `
Jordan Lee
jordan@example.com | San Francisco, CA


EXPERIENCE

Software Engineer, Acme Corp
2021 - Present
- Built a resume analysis pipeline serving 10k+ users
- Reduced API latency by 40% through caching

Software Engineer Intern, Startup Inc
2020 - 2021
- Shipped a React dashboard used by the support team


PROJECTS

ResumeIQ
- RAG-based resume analyzer using Groq and TanStack Start


SKILLS
TypeScript, React, Node.js, PostgreSQL


EDUCATION

B.S. Computer Science, State University
2016 - 2020


AWARDS

Dean's List, 2019
`;

describe("normalizeResumeText", () => {
  it("collapses excessive blank lines", () => {
    const normalized = normalizeResumeText("a\n\n\n\n\nb");
    expect(normalized).toBe("a\n\nb");
  });

  it("trims leading and trailing whitespace", () => {
    expect(normalizeResumeText("  hello  \n")).toBe("hello");
  });
});

describe("detectSections", () => {
  it("detects standard resume section headings", () => {
    const sections = detectSections(normalizeResumeText(SAMPLE_RESUME));
    const kinds = sections.map((s) => s.kind);
    expect(kinds).toContain("experience");
    expect(kinds).toContain("projects");
    expect(kinds).toContain("skills");
    expect(kinds).toContain("education");
    expect(kinds).toContain("awards");
  });

  it("keeps pre-heading content (name/contact) as a summary section", () => {
    const sections = detectSections(normalizeResumeText(SAMPLE_RESUME));
    expect(sections[0].kind).toBe("summary");
    expect(sections[0].content).toContain("Jordan Lee");
  });

  it("preserves document order via the order field", () => {
    const sections = detectSections(normalizeResumeText(SAMPLE_RESUME));
    const orders = sections.map((s) => s.order);
    expect(orders).toEqual([...orders].sort((a, b) => a - b));
  });

  it("recognizes common heading aliases (e.g. Work History for Experience)", () => {
    const text = normalizeResumeText(
      "Summary\nBuilds things.\n\nWORK HISTORY\nEngineer at X\n",
    );
    const sections = detectSections(text);
    expect(sections.some((s) => s.kind === "experience")).toBe(true);
  });

  it("treats text with no detectable headings as a single summary section", () => {
    const text = normalizeResumeText("just some plain text with no headings at all");
    const sections = detectSections(text);
    expect(sections).toHaveLength(1);
    expect(sections[0].kind).toBe("summary");
  });

  it("falls back to 'other' for the edge case of heading-only content with no body", () => {
    // A single line that reads as a heading with nothing following it never gets
    // flushed into the normal per-heading buffer, so this exercises the empty-buffer
    // fallback path rather than the "no headings at all" path above.
    const sections = detectSections("EXPERIENCE");
    expect(sections).toHaveLength(1);
    expect(sections[0].kind).toBe("other");
  });

  it("does not misclassify a bullet line as a heading", () => {
    const text = normalizeResumeText(
      "EXPERIENCE\n- Improved throughput by 20%\nEDUCATION\nB.S. CS",
    );
    const sections = detectSections(text);
    const experience = sections.find((s) => s.kind === "experience");
    expect(experience?.content).toContain("Improved throughput");
  });
});
