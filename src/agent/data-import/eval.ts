/**
 * Data Import Agent -- Evaluation Suite
 *
 * Phase 7.6: Quality evaluations for the data import agent.
 * Evals run automatically via `waitUntil()` after each response.
 */

import agent from "./agent";

/**
 * Output Structure: Validates that the import result contains all
 * required fields with correct types.
 */
export const importOutputStructureEval = agent.createEval(
  "import-output-structure",
  {
    description:
      "Validates that import output has all required fields (success, counts, duration)",
    handler: async (_ctx, _input, output) => {
      const data = (output as any)?.data ?? output;
      const hasSuccess = typeof data?.success === "boolean";
      const hasImportType = typeof data?.importType === "string" && data.importType.length > 0;
      const hasProcessed = typeof data?.recordsProcessed === "number";
      const hasCreated = typeof data?.recordsCreated === "number";
      const hasUpdated = typeof data?.recordsUpdated === "number";
      const hasSkipped = typeof data?.recordsSkipped === "number";
      const hasDuration = typeof data?.durationMs === "number";
      const hasErrors = Array.isArray(data?.errors);

      const checks = [
        hasSuccess,
        hasImportType,
        hasProcessed,
        hasCreated,
        hasUpdated,
        hasSkipped,
        hasDuration,
        hasErrors,
      ];
      const passed = checks.every(Boolean);
      const score = checks.filter(Boolean).length / checks.length;

      return {
        passed,
        score,
        reason: passed
          ? "Import output has all required fields"
          : `Missing fields: ${[
              !hasSuccess && "success",
              !hasImportType && "importType",
              !hasProcessed && "recordsProcessed",
              !hasCreated && "recordsCreated",
              !hasUpdated && "recordsUpdated",
              !hasSkipped && "recordsSkipped",
              !hasDuration && "durationMs",
              !hasErrors && "errors",
            ]
              .filter(Boolean)
              .join(", ")}`,
        metadata: {
          success: data?.success,
          importType: data?.importType,
          recordsProcessed: data?.recordsProcessed,
        },
      };
    },
  }
);

/**
 * Error Handling: Verifies that failed imports include meaningful
 * error messages and that error counts are consistent.
 */
export const importErrorHandlingEval = agent.createEval(
  "import-error-handling",
  {
    description:
      "Validates error handling consistency -- error count matches errors array length",
    handler: async (_ctx, _input, output) => {
      const data = (output as any)?.data ?? output;
      const errors = data?.errors ?? [];
      const success = data?.success;
      const processed = data?.recordsProcessed ?? 0;
      const created = data?.recordsCreated ?? 0;
      const updated = data?.recordsUpdated ?? 0;
      const skipped = data?.recordsSkipped ?? 0;

      // If success is false, there should be errors
      if (success === false && errors.length === 0 && processed > 0) {
        return {
          passed: false,
          score: 0.3,
          reason: "Import reported failure but no errors in the errors array",
          metadata: { success, errorCount: errors.length, processed },
        };
      }

      // Record count consistency: processed should >= created + updated + skipped + errors
      const accountedFor = created + updated + skipped + errors.length;
      const consistent = processed === 0 || accountedFor >= processed;

      // Each error should have a message
      const allErrorsHaveMessages = errors.every(
        (e: any) => typeof e.message === "string" && e.message.length > 0
      );

      const passed = consistent && allErrorsHaveMessages;
      const score = (consistent ? 0.5 : 0) + (allErrorsHaveMessages ? 0.5 : 0);

      return {
        passed,
        score,
        reason: passed
          ? `Import accounting consistent: ${created} created, ${updated} updated, ${skipped} skipped, ${errors.length} errors`
          : !consistent
            ? `Record count inconsistency: processed=${processed}, accounted=${accountedFor}`
            : "Some errors missing messages",
        metadata: {
          processed,
          created,
          updated,
          skipped,
          errorCount: errors.length,
          accountedFor,
          consistent,
          allErrorsHaveMessages,
        },
      };
    },
  }
);
