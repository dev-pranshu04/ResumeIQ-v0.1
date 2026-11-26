import { describe, expect, it } from "vitest";
import { buildRequirementEvidence } from "./jd-evidence";

const RESUME = `
EXPERIENCE

Senior Backend Engineer, Acme Corp
2021 - Present
- Designed and operated Kubernetes-based microservices handling 5M requests/day
- Migrated legacy PHP monolith to Node.js and PostgreSQL

PROJECTS

ResumeIQ
- Built a resume analyzer using TypeScript, React, and Groq

SKILLS
Kubernetes, Docker, Node.js, PostgreSQL, TypeScript, React
`;

const JD = `
Requirements
- Strong experience with Kubernetes and container orchestration
- Proficiency in Node.js and PostgreSQL
- Experience with underwater basket weaving
`;

describe("buildRequirementEvidence", () => {
  it("cites a matching resume chunk for a requirement the resume supports", () => {
    const evidence = buildRequirementEvidence(RESUME, JD);
    const k8s = evidence.find((e) => e.requirement.includes("Kubernetes"));
    expect(k8s?.matched).toBe(true);
    // Either the Experience bullet or the Skills list is legitimate evidence here —
    // both literally mention Kubernetes, and which one BM25 ranks first can
    // legitimately depend on chunk length normalization, not just topical relevance.
    expect(["experience", "skills"]).toContain(k8s?.bestChunkSection);
    expect(k8s?.snippet).toContain("Kubernetes");
  });

  it("marks a requirement with no real resume support as unmatched", () => {
    const evidence = buildRequirementEvidence(RESUME, JD);
    const weaving = evidence.find((e) =>
      e.requirement.includes("basket weaving"),
    );
    expect(weaving?.matched).toBe(false);
    expect(weaving?.snippet).toBeNull();
  });

  it("does not match purely because a chunk was ranked first among few candidates (regression: RRF top-1 is not evidence)", () => {
    // A tiny resume with only unrelated content — RRF will still rank *some* chunk
    // "first" for any query, but that alone must not count as a match.
    const tinyResume = "EXPERIENCE\nBarista, Local Cafe\n- Made espresso drinks";
    const evidence = buildRequirementEvidence(
      tinyResume,
      "Requirements\n- 10+ years of quantum computing research experience",
    );
    expect(evidence.every((e) => e.matched === false)).toBe(true);
  });

  it("produces a similarity score between 0 and 100 for every requirement", () => {
    const evidence = buildRequirementEvidence(RESUME, JD);
    for (const e of evidence) {
      expect(e.similarityScore).toBeGreaterThanOrEqual(0);
      expect(e.similarityScore).toBeLessThanOrEqual(100);
    }
  });

  it("returns an empty array when the resume has no extractable chunks", () => {
    expect(buildRequirementEvidence("", JD)).toEqual([]);
  });

  it("returns an empty array when no requirements are extractable from the JD", () => {
    expect(buildRequirementEvidence(RESUME, "")).toEqual([]);
  });
});
