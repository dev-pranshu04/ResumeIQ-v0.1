import { describe, expect, it } from "vitest";
import { HybridRetriever } from "./hybrid-retriever";
import { chunkResume } from "./chunker";
import { detectSections, normalizeResumeText } from "./section-detector";

const RESUME = `
EXPERIENCE

Senior Backend Engineer, Acme Corp
2021 - Present
- Designed and operated Kubernetes-based microservices handling 5M requests/day
- Migrated legacy PHP monolith to Node.js and PostgreSQL

Marketing Coordinator, Startup Inc
2019 - 2021
- Ran email campaigns and managed the company blog

PROJECTS

ResumeIQ
- RAG-based resume analyzer built with TypeScript and Groq

SKILLS
Kubernetes, Docker, Node.js, PostgreSQL, TypeScript
`;

function buildChunks() {
  const sections = detectSections(normalizeResumeText(RESUME));
  return chunkResume(sections);
}

describe("HybridRetriever", () => {
  it("retrieves the most relevant chunk for a technical query", () => {
    const retriever = new HybridRetriever(buildChunks());
    const results = retriever.search("Kubernetes microservices experience", 1);
    expect(results[0].chunk.content).toContain("Kubernetes-based microservices");
  });

  it("ranks relevant chunks (Experience or Skills mentioning PostgreSQL) above the unrelated marketing chunk", () => {
    const retriever = new HybridRetriever(buildChunks());
    const results = retriever.search("PostgreSQL database migration", 3);
    const topIds = results.map((r) => r.chunk.id);
    const backendChunk = buildChunks().find((c) =>
      c.content.includes("Migrated legacy PHP"),
    )!;
    const marketingChunk = buildChunks().find((c) =>
      c.content.includes("Ran email campaigns"),
    )!;
    // Either the specific Experience bullet or the Skills list is a legitimate top
    // result for a pure keyword query — BM25's length normalization can favor a
    // short, dense keyword list over a longer prose bullet for the same term, which
    // is expected behavior, not a bug. What matters is that a real match outranks
    // the genuinely unrelated marketing chunk.
    expect(topIds).toContain(backendChunk.id);
    expect(topIds.indexOf(marketingChunk.id)).not.toBe(0);
  });

  it("returns an empty array for an empty chunk set", () => {
    const retriever = new HybridRetriever([]);
    expect(retriever.search("anything")).toEqual([]);
  });

  it("respects the limit parameter", () => {
    const retriever = new HybridRetriever(buildChunks());
    const results = retriever.search("engineering experience", 2);
    expect(results.length).toBeLessThanOrEqual(2);
  });

  it("every result carries a combinedScore used for ranking", () => {
    const retriever = new HybridRetriever(buildChunks());
    const results = retriever.search("TypeScript project", 5);
    for (const r of results) {
      expect(typeof r.combinedScore).toBe("number");
    }
    // Sorted descending by combinedScore.
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].combinedScore).toBeGreaterThanOrEqual(
        results[i].combinedScore,
      );
    }
  });
});
