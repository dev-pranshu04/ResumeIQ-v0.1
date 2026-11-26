import { describe, expect, it } from "vitest";
import { cosineSimilarity, embed, embedCached } from "./embeddings";

describe("embed", () => {
  it("is deterministic for the same input", () => {
    const a = embed("Experienced React and TypeScript engineer");
    const b = embed("Experienced React and TypeScript engineer");
    expect(a).toEqual(b);
  });

  it("returns a fixed-length vector", () => {
    const short = embed("AWS");
    const long = embed(
      "A much longer piece of text describing many different skills and technologies used across several projects",
    );
    expect(short.length).toBe(long.length);
  });

  it("returns a zero vector for empty input", () => {
    const vector = embed("");
    expect(vector.every((v) => v === 0)).toBe(true);
  });

  it("produces near-identical vectors for near-duplicate text", () => {
    const a = embed("Built a REST API using Node.js and PostgreSQL");
    const b = embed("Built a REST API using Node.js and PostgreSQL.");
    expect(cosineSimilarity(a, a)).toBeCloseTo(1, 5);
    expect(cosineSimilarity(a, b)).toBeGreaterThan(0.95);
  });
});

describe("cosineSimilarity", () => {
  it("returns 1 for identical vectors", () => {
    const v = embed("Kubernetes and Docker experience");
    expect(cosineSimilarity(v, v)).toBeCloseTo(1, 5);
  });

  it("returns a higher score for related text than unrelated text", () => {
    const query = embed("machine learning and PyTorch experience");
    const related = embed("Trained deep learning models using PyTorch");
    const unrelated = embed("Managed vendor contracts and office supplies");
    expect(cosineSimilarity(query, related)).toBeGreaterThan(
      cosineSimilarity(query, unrelated),
    );
  });

  it("captures partial matches between spelling/casing variants via n-grams", () => {
    const query = embed("PostgreSQL database experience");
    const variant = embed("Extensive Postgres database work");
    const unrelated = embed("Led quarterly marketing campaigns");
    expect(cosineSimilarity(query, variant)).toBeGreaterThan(
      cosineSimilarity(query, unrelated),
    );
  });
});

describe("embedCached", () => {
  it("returns the same vector as embed() for the same text", () => {
    expect(embedCached("Go microservices at scale")).toEqual(
      embed("Go microservices at scale"),
    );
  });
});
