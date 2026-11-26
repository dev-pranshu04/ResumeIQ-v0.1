import { describe, expect, it } from "vitest";
import { chunkResume } from "./chunker";
import { detectSections, normalizeResumeText } from "./section-detector";

const SAMPLE_RESUME = `
EXPERIENCE

Software Engineer, Acme Corp
2021 - Present
- Built a resume analysis pipeline

Software Engineer Intern, Startup Inc
2020 - 2021
- Shipped a React dashboard


SKILLS
TypeScript, React, Node.js
`;

describe("chunkResume", () => {
  it("splits a multi-entry section (Experience) into separate chunks per job", () => {
    const sections = detectSections(normalizeResumeText(SAMPLE_RESUME));
    const chunks = chunkResume(sections);
    const experienceChunks = chunks.filter((c) => c.section === "experience");
    expect(experienceChunks.length).toBe(2);
    expect(experienceChunks[0].content).toContain("Acme Corp");
    expect(experienceChunks[1].content).toContain("Startup Inc");
  });

  it("keeps atomic sections (Skills) as a single chunk", () => {
    const sections = detectSections(normalizeResumeText(SAMPLE_RESUME));
    const chunks = chunkResume(sections);
    const skillsChunks = chunks.filter((c) => c.section === "skills");
    expect(skillsChunks.length).toBe(1);
  });

  it("assigns a unique id to every chunk", () => {
    const sections = detectSections(normalizeResumeText(SAMPLE_RESUME));
    const chunks = chunkResume(sections);
    const ids = chunks.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("derives a readable title from the first line of each entry", () => {
    const sections = detectSections(normalizeResumeText(SAMPLE_RESUME));
    const chunks = chunkResume(sections);
    const acme = chunks.find((c) => c.content.includes("Acme Corp"));
    expect(acme?.title).toContain("Acme Corp");
  });

  it("computes a token count for every chunk", () => {
    const sections = detectSections(normalizeResumeText(SAMPLE_RESUME));
    const chunks = chunkResume(sections);
    for (const chunk of chunks) {
      expect(chunk.tokenCount).toBeGreaterThan(0);
    }
  });
});
