/**
 * Eval Routes — Phase 7.6
 *
 * Endpoints for running agent evaluation suites.
 *
 * IMPORTANT: Automated eval scheduling is handled entirely via the
 * Admin Console → Automation → Scheduler. Create a schedule with
 * taskType "eval" to run evals on any cron cadence. No hardcoded
 * cron is shipped — each deployment decides if/when evals run.
 *
 * Manual trigger: POST /api/admin/evals/run
 */

import { createRouter } from "@agentuity/runtime";
import { errorMiddleware } from "@lib/errors";
import { sessionMiddleware } from "@lib/auth";
import { recordEvalResults, type RecordEvalInput } from "@services/eval-results";

const router = createRouter();
router.use(errorMiddleware());

// ── Test suites per agent ───────────────────────────────────

interface TestCase {
  name: string;
  input: Record<string, unknown>;
  validate: (output: any) => { passed: boolean; score: number; reason: string };
}

const DATA_SCIENCE_TESTS: TestCase[] = [
  {
    name: "greeting-response",
    input: { message: "Hello, how are you?", sessionId: "eval-auto" },
    validate: (output) => {
      const text = output?.text ?? "";
      const passed = text.length >= 10 && !/error/i.test(text.slice(0, 20));
      return {
        passed,
        score: passed ? 1 : 0,
        reason: passed ? "Valid greeting response" : "Empty or error response",
      };
    },
  },
  {
    name: "data-query-response",
    input: {
      message: "How many products do we have in our catalog?",
      sessionId: "eval-auto",
    },
    validate: (output) => {
      const text = output?.text ?? "";
      const hasNumber = /\d+/.test(text);
      const notError = !/error|failed|exception/i.test(text.slice(0, 50));
      const passed = hasNumber && notError && text.length >= 20;
      return {
        passed,
        score: passed ? 1 : hasNumber ? 0.5 : 0,
        reason: passed
          ? "Response includes data with numbers"
          : "Missing data or error in response",
      };
    },
  },
  {
    name: "tool-usage-check",
    input: {
      message: "What are our top 5 selling products this month?",
      sessionId: "eval-auto",
    },
    validate: (output) => {
      const toolCalls = output?.toolCalls ?? [];
      const text = output?.text ?? "";
      const usedTools = toolCalls.length > 0;
      const hasContent = text.length >= 30;
      const passed = usedTools && hasContent;
      return {
        passed,
        score: usedTools ? 1 : 0.2,
        reason: passed
          ? `Used ${toolCalls.length} tool(s) with substantive response`
          : usedTools
            ? "Used tools but response is too short"
            : "No tools used for a data query",
      };
    },
  },
];

const KNOWLEDGE_BASE_TESTS: TestCase[] = [
  {
    name: "query-empty-kb",
    input: { action: "query", question: "What is our return policy?" },
    validate: (output) => {
      const success = output?.success === true;
      const hasAnswer = typeof output?.answer === "string" && output.answer.length > 0;
      return {
        passed: success && hasAnswer,
        score: success ? 1 : 0,
        reason: success
          ? "Successfully handled query (even if no docs found)"
          : "Query handler failed",
      };
    },
  },
  {
    name: "list-documents",
    input: { action: "list" },
    validate: (output) => {
      const success = output?.success === true;
      return {
        passed: success,
        score: success ? 1 : 0,
        reason: success ? "Document listing succeeded" : "Document listing failed",
      };
    },
  },
];

// ── Run eval suite for an agent ─────────────────────────────

async function runAgentEvals(
  agentName: string,
  agentModule: any,
  tests: TestCase[],
  logger: any
): Promise<RecordEvalInput[]> {
  const results: RecordEvalInput[] = [];

  for (const test of tests) {
    try {
      const startMs = Date.now();
      const output = await agentModule.default.run(test.input);
      const durationMs = Date.now() - startMs;

      const { passed, score, reason } = test.validate(output);
      results.push({
        agentName,
        evalName: test.name,
        passed,
        score,
        reason,
        metadata: { durationMs, automated: true },
      });

      logger.info(`Eval ${agentName}/${test.name}: ${passed ? "PASS" : "FAIL"}`, {
        score,
        durationMs,
      });
    } catch (err: any) {
      results.push({
        agentName,
        evalName: test.name,
        passed: false,
        score: 0,
        reason: `Runtime error: ${err.message?.slice(0, 200)}`,
        metadata: { error: true, automated: true },
      });

      logger.warn(`Eval ${agentName}/${test.name}: ERROR`, {
        error: err.message?.slice(0, 200),
      });
    }
  }

  return results;
}

/**
 * Run all eval suites and persist results.
 * Shared implementation for both the manual trigger and the scheduler task.
 */
export async function runAllEvals(logger: any): Promise<{
  success: boolean;
  totalTests: number;
  passed: number;
  failed: number;
  results: Array<{ agent: string; eval: string; passed: boolean; score: number; reason?: string }>;
}> {
  const allResults: RecordEvalInput[] = [];

  // Run data-science agent evals
  try {
    const dataScienceAgent = await import("@agent/data-science");
    const dsResults = await runAgentEvals(
      "data-science",
      dataScienceAgent,
      DATA_SCIENCE_TESTS,
      logger
    );
    allResults.push(...dsResults);
  } catch (err: any) {
    logger.warn("Failed to run data-science evals", {
      error: err.message?.slice(0, 200),
    });
  }

  // Run knowledge-base agent evals
  try {
    const kbAgent = await import("@agent/knowledge-base");
    const kbResults = await runAgentEvals(
      "knowledge-base",
      kbAgent,
      KNOWLEDGE_BASE_TESTS,
      logger
    );
    allResults.push(...kbResults);
  } catch (err: any) {
    logger.warn("Failed to run knowledge-base evals", {
      error: err.message?.slice(0, 200),
    });
  }

  // Persist all results
  if (allResults.length > 0) {
    try {
      await recordEvalResults(allResults);
      logger.info("Eval results saved", {
        totalTests: allResults.length,
        passed: allResults.filter((r) => r.passed).length,
        failed: allResults.filter((r) => !r.passed).length,
      });
    } catch (err: any) {
      logger.warn("Failed to persist eval results", {
        error: err.message?.slice(0, 200),
      });
    }
  }

  return {
    success: true,
    totalTests: allResults.length,
    passed: allResults.filter((r) => r.passed).length,
    failed: allResults.filter((r) => !r.passed).length,
    results: allResults.map((r) => ({
      agent: r.agentName,
      eval: r.evalName,
      passed: r.passed,
      score: r.score ?? 0,
      reason: r.reason,
    })),
  };
}

// ── Manual trigger (admin-only) ─────────────────────────────

router.post("/admin/evals/run", sessionMiddleware(), async (c) => {
  const logger = c.var.logger ?? console;
  logger.info("Starting manual eval run");
  const result = await runAllEvals(logger);
  return c.json(result);
});

export default router;
