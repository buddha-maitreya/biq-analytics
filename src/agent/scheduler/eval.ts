/**
 * Scheduler Agent -- Evaluation suite
 *
 * Validates that the scheduler agent:
 *   1. Executes tasks and produces valid output structure
 *   2. Dispatches to the correct handler based on taskType
 */

import scheduler from "./agent";

/** Eval: execution output has the required fields */
export const scheduleExecutionEval = scheduler.createEval(
  "schedule-execution-structure",
  {
    description: "Validates that scheduler output contains required fields",
    handler: async (_ctx, _input, output) => {
      const data = (output as any)?.data ?? output;
      const hasScheduleId = typeof data?.scheduleId === "string" && data.scheduleId.length > 0;
      const hasExecutionId = typeof data?.executionId === "string" && data.executionId.length > 0;
      const hasTaskType = typeof data?.taskType === "string";
      const hasSuccess = typeof data?.success === "boolean";

      const checks = [hasScheduleId, hasExecutionId, hasTaskType, hasSuccess];
      const passed = checks.every(Boolean);
      const score = checks.filter(Boolean).length / checks.length;

      return {
        passed,
        score,
        reason: passed
          ? "Execution output has all required fields"
          : `Missing fields: ${[
              !hasScheduleId && "scheduleId",
              !hasExecutionId && "executionId",
              !hasTaskType && "taskType",
              !hasSuccess && "success",
            ]
              .filter(Boolean)
              .join(", ")}`,
      };
    },
  }
);

/** Eval: task type is reflected correctly in output */
export const taskDispatchEval = scheduler.createEval("task-dispatch-correct", {
  description: "Validates that the taskType in output matches the input",
  handler: async (_ctx, input, output) => {
    const inp = input as any;
    const out = (output as any)?.data ?? output;
    const inputType = inp?.data?.taskType ?? inp?.taskType;
    const outputType = out?.taskType;
    const passed = inputType === outputType;

    return {
      passed,
      score: passed ? 1 : 0,
      reason: passed
        ? `Task type correctly dispatched: ${outputType}`
        : `Task type mismatch: input=${inputType}, output=${outputType}`,
    };
  },
});
