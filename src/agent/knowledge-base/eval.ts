/**
 * Knowledge Base Agent -- Evaluation Suite
 *
 * Phase 7.6: Quality evaluations for the RAG / document retrieval agent.
 * Evals run automatically via `waitUntil()` after each response.
 */

import agent from "./agent";

/**
 * Answer Groundedness: For query operations, verifies the answer
 * references source citations (not making things up).
 */
export const answerGroundednessEval = agent.createEval("answer-groundedness", {
  description:
    "Verifies RAG answers reference source citations [Source N] from retrieved documents",
  handler: async (_ctx, input, output) => {
    // Only evaluate query operations with successful answers
    if (input.action !== "query" || !output.success || !output.answer) {
      return {
        passed: true,
        reason: "Non-query operation or unsuccessful — eval not applicable",
        metadata: { action: input.action, success: output.success },
      };
    }

    const answer = output.answer;
    const sources = output.sources ?? [];

    // Check for [Source N] citation notation
    const citationMatches = answer.match(/\[Source\s+\d+\]/gi) || [];
    const hasCitations = citationMatches.length > 0;

    // If no sources were retrieved, citations aren't expected
    if (sources.length === 0) {
      return {
        passed: true,
        reason: "No sources retrieved — citations not expected",
        metadata: { sourcesCount: 0 },
      };
    }

    return {
      passed: hasCitations,
      reason: hasCitations
        ? `${citationMatches.length} citation(s) found referencing ${sources.length} source(s)`
        : `No [Source N] citations found despite ${sources.length} available source(s) — answer may not be grounded`,
      score: hasCitations ? 1 : 0.3,
      metadata: {
        citationCount: citationMatches.length,
        sourcesCount: sources.length,
        answerLength: answer.length,
      },
    };
  },
});

/**
 * Retrieval Relevance: Checks that retrieved sources have
 * reasonable similarity scores (not returning irrelevant chunks).
 */
export const retrievalRelevanceEval = agent.createEval("retrieval-relevance", {
  description:
    "Verifies retrieved source chunks have adequate similarity scores",
  handler: async (_ctx, input, output) => {
    if (input.action !== "query" || !output.sources?.length) {
      return {
        passed: true,
        reason: "No sources to evaluate",
        metadata: { action: input.action },
      };
    }

    const similarities = output.sources.map((s: any) => s.similarity);
    const avg =
      similarities.reduce((a: number, b: number) => a + b, 0) /
      similarities.length;
    const min = Math.min(...similarities);

    // Average similarity should be at least 0.3 (below that, retrieval is noise)
    const passed = avg >= 0.3;

    return {
      passed,
      reason: passed
        ? `Average similarity ${avg.toFixed(3)} (min: ${min.toFixed(3)})`
        : `Average similarity ${avg.toFixed(3)} is below threshold (0.3) — retrieval may be irrelevant`,
      score: Math.min(avg / 0.7, 1),
      metadata: {
        avgSimilarity: avg,
        minSimilarity: min,
        maxSimilarity: Math.max(...similarities),
        sourceCount: similarities.length,
      },
    };
  },
});

/**
 * Ingest Success: For ingest operations, checks that chunks were
 * actually ingested (non-zero count).
 */
export const ingestSuccessEval = agent.createEval("ingest-success", {
  description: "Verifies document ingestion produced at least one chunk",
  handler: async (_ctx, input, output) => {
    if (input.action !== "ingest") {
      return {
        passed: true,
        reason: "Non-ingest operation — eval not applicable",
        metadata: { action: input.action },
      };
    }

    const ingested = output.ingested ?? 0;
    const passed = output.success && ingested > 0;

    return {
      passed,
      reason: passed
        ? `Successfully ingested ${ingested} chunk(s)`
        : `Ingestion ${output.success ? "succeeded but 0 chunks" : "failed"}`,
      score: passed ? 1 : 0,
      metadata: { success: output.success, chunksIngested: ingested },
    };
  },
});
