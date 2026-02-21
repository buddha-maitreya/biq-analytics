/**
 * Scheduler Agent -- Barrel export
 *
 * The SDK discovers agents by scanning for index.ts files in src/agent/.
 */

export { default } from "./agent";

// Phase 5.6 — Evals (SDK discovers named exports)
export { scheduleExecutionEval, taskDispatchEval } from "./eval";

// Phase 7 — Workbench test prompts
export const welcome = () => ({
  welcome: "Welcome to the **Scheduler Agent**.\nI execute scheduled tasks like report generation, insight analysis, alerts, and cleanup.",
  prompts: [
    {
      data: JSON.stringify({
        scheduleId: "test-schedule-001",
        taskType: "report",
        taskConfig: { reportType: "sales-summary" },
        triggerSource: "manual",
      }),
      contentType: "application/json",
    },
  ],
});
