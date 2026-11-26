import { describe, expect, it } from "vitest";
import { extractRequirements } from "./jd-requirements";

const JD = `
About Us
We're a fast-growing startup building developer tools.

Requirements
- 5+ years of experience building backend services in Node.js or Go
- Strong understanding of distributed systems and Kubernetes
- Experience with PostgreSQL or another relational database
- Excellent communication skills

Benefits
- Competitive salary and equity
- Equal Opportunity Employer
`;

describe("extractRequirements", () => {
  it("extracts bullet-point requirement lines", () => {
    const reqs = extractRequirements(JD);
    expect(reqs.some((r) => r.includes("Node.js or Go"))).toBe(true);
    expect(reqs.some((r) => r.includes("Kubernetes"))).toBe(true);
  });

  it("filters out boilerplate/noise sections", () => {
    const reqs = extractRequirements(JD);
    expect(reqs.some((r) => /equal opportunity/i.test(r))).toBe(false);
    expect(reqs.some((r) => /about us/i.test(r))).toBe(false);
  });

  it("filters out very short lines", () => {
    const reqs = extractRequirements("Requirements\n- Go\n- 5+ years of backend engineering experience with distributed systems");
    expect(reqs.every((r) => r.length >= 12)).toBe(true);
  });

  it("deduplicates identical lines", () => {
    const reqs = extractRequirements(
      "- Experience with PostgreSQL databases\n- Experience with PostgreSQL databases",
    );
    expect(reqs.length).toBe(1);
  });

  it("caps the number of extracted requirements", () => {
    const manyLines = Array.from(
      { length: 50 },
      (_, i) => `- Requirement number ${i} needs real backend engineering skills`,
    ).join("\n");
    const reqs = extractRequirements(manyLines);
    expect(reqs.length).toBeLessThanOrEqual(15);
  });

  it("returns an empty array for empty input", () => {
    expect(extractRequirements("")).toEqual([]);
  });
});
