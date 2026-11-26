import { describe, expect, it } from "vitest";
import { Bm25Index } from "./bm25";

const DOCS = [
  { id: "a", text: "Built scalable APIs using Node.js and PostgreSQL" },
  { id: "b", text: "Led a team of designers on brand identity projects" },
  { id: "c", text: "Implemented CI/CD pipelines with Docker and Kubernetes" },
];

describe("Bm25Index", () => {
  it("ranks the document with matching terms above unrelated documents", () => {
    const index = new Bm25Index(DOCS);
    const results = index.search("Node.js PostgreSQL API");
    expect(results[0].id).toBe("a");
    expect(results[0].score).toBeGreaterThan(
      results.find((r) => r.id === "b")!.score,
    );
  });

  it("gives every document a zero score for an empty query", () => {
    const index = new Bm25Index(DOCS);
    const results = index.search("");
    expect(results.every((r) => r.score === 0)).toBe(true);
  });

  it("handles an empty corpus without throwing", () => {
    const index = new Bm25Index([]);
    expect(index.search("anything")).toEqual([]);
  });

  it("scores a document with no matching terms as 0", () => {
    const index = new Bm25Index(DOCS);
    const results = index.search("gardening watercolor painting");
    expect(results.every((r) => r.score === 0)).toBe(true);
  });

  it("ranks Kubernetes/Docker document above others for a devops query", () => {
    const index = new Bm25Index(DOCS);
    const results = index.search("Kubernetes Docker CI/CD pipeline");
    expect(results[0].id).toBe("c");
  });
});
