/**
 * Dev-only evaluation CLI. Run with `bun run eval`.
 *
 * Prints real, measured retrieval-quality numbers (Recall@k, MRR, NDCG, a
 * match/no-match confusion matrix, latency) computed by running the actual
 * production retrieval code against a small hand-labeled dataset
 * (src/lib/rag/eval/dataset.ts). This has zero UI footprint — it's a script, not a
 * route — and zero cost: no network calls, no API key required for the retrieval
 * section.
 *
 * If GROQ_API_KEY is set, it additionally runs one real end-to-end JD Matcher call
 * and reports a deterministic faithfulness check on the LLM's output (are its claimed
 * matched keywords actually findable in the resume/JD text?). This section is skipped
 * gracefully — not an error — when no key is configured, since it's meant to be
 * optional, not a requirement to run the core eval.
 */
import { runRetrievalEval } from "../src/lib/rag/eval/run-retrieval-eval";

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function printRetrievalReport() {
  const report = runRetrievalEval();

  console.log("\n=== Retrieval Ranking Quality (Recall / MRR / NDCG) ===");
  console.log(`Queries evaluated (shouldMatch=true only): ${report.ranking.queriesEvaluated}`);
  console.log(`Recall@1:  ${pct(report.ranking.recallAt1)}`);
  console.log(`Recall@3:  ${pct(report.ranking.recallAt3)}`);
  console.log(`Recall@5:  ${pct(report.ranking.recallAt5)}`);
  console.log(`MRR:       ${report.ranking.mrr.toFixed(3)}`);
  console.log(`NDCG@5:    ${report.ranking.ndcgAt5.toFixed(3)}`);

  console.log("\n=== Match/No-Match Classification (all queries) ===");
  const c = report.classification;
  console.log(`Accuracy:  ${pct(c.accuracy)}`);
  console.log(`Precision: ${pct(c.precision)}`);
  console.log(`Recall:    ${pct(c.recall)}`);
  console.log(`F1:        ${c.f1.toFixed(3)}`);
  console.log(
    `Confusion matrix: TP=${c.truePositive} TN=${c.trueNegative} FP=${c.falsePositive} FN=${c.falseNegative}`,
  );

  console.log("\n=== Latency ===");
  console.log(`Avg retrieval latency: ${report.avgLatencyMs.toFixed(2)}ms/query`);

  const failures = report.perQuery.filter((q) => q.predictedMatch !== q.shouldMatch);
  if (failures.length > 0) {
    console.log("\n=== Misclassified queries ===");
    for (const f of failures) {
      console.log(
        `  [${f.case}] "${f.requirement}" — expected matched=${f.shouldMatch}, got matched=${f.predictedMatch}`,
      );
    }
  } else {
    console.log("\nNo misclassified queries in this run.");
  }

  return report;
}

async function runFaithfulnessCheckIfConfigured() {
  if (!process.env.GROQ_API_KEY) {
    console.log(
      "\n=== Faithfulness check (live LLM call) ===\nSkipped: GROQ_API_KEY not set. This section is optional — the retrieval report above is the primary, free, deterministic result.",
    );
    return;
  }

  console.log("\n=== Faithfulness check (live LLM call) ===");
  try {
    const { buildRequirementEvidence } = await import(
      "../src/lib/rag/jd-evidence"
    );
    const { buildJdMatchPrompt } = await import("../src/lib/ai/prompts");
    const { callGroqStructured } = await import("../src/lib/ai/groq-client");
    const { jdMatchResultSchema } = await import("../src/lib/ai/schemas");
    const { EVAL_CASES } = await import("../src/lib/rag/eval/dataset");

    const sample = EVAL_CASES[0];
    const jobDescription = sample.requirements.map((r) => `- ${r.requirement}`).join("\n");
    const evidence = buildRequirementEvidence(sample.resume, jobDescription);
    const { system, user } = buildJdMatchPrompt({
      resumeText: sample.resume,
      jobDescription,
      targetRole: "Software Engineer",
      evidence,
    });

    const result = await callGroqStructured({
      system,
      user,
      schema: jdMatchResultSchema,
      maxTokens: 2200,
    });

    // Deterministic grounding check: for each keyword the model claims is matched,
    // confirm it's actually findable (case-insensitive substring) in the resume or JD
    // text. This is intentionally NOT another LLM call judging the first — that would
    // add cost and non-determinism without a clear accuracy win at this scale; a
    // literal grounding check is free, deterministic, and catches the failure mode
    // that actually matters here (the model claiming a keyword match that isn't
    // really there).
    const haystack = `${sample.resume}\n${jobDescription}`.toLowerCase();
    const claims = result.matchedKeywords;
    const grounded = claims.filter((k) => haystack.includes(k.toLowerCase()));
    const faithfulness = claims.length === 0 ? 1 : grounded.length / claims.length;

    console.log(`Sample case: ${sample.name}`);
    console.log(`LLM matchedKeywords claimed: ${claims.length}`);
    console.log(`Grounded in resume/JD text: ${grounded.length}`);
    console.log(`Faithfulness score: ${pct(faithfulness)}`);
    if (grounded.length < claims.length) {
      const ungrounded = claims.filter((k) => !grounded.includes(k));
      console.log(`Ungrounded claims: ${ungrounded.join(", ")}`);
    }
  } catch (err) {
    console.log(
      `Faithfulness check failed to run: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

async function main() {
  console.log("ResumeIQ Retrieval Evaluation");
  console.log("==============================");
  printRetrievalReport();
  await runFaithfulnessCheckIfConfigured();
  console.log("\nDone.\n");
}

main();
