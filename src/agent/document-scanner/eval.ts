/**
 * Document Scanner Agent -- Evaluation Suite
 *
 * Quality evaluations for the document scanner agent.
 */

import agent from "./agent";

/**
 * Extraction Accuracy: Verifies the agent returns valid structured data
 * with expected fields based on the processing mode.
 */
export const extractionAccuracyEval = agent.createEval("extraction-accuracy", {
  description:
    "Verifies the scanner returns valid structured data with expected fields",
  handler: async (_ctx, input, output) => {
    const mode = input.mode ?? "barcode";
    const data = output.data;
    const success = output.success === true;

    if (!success) {
      return {
        passed: false,
        reason: `Extraction failed: ${output.error ?? "unknown error"}`,
        score: 0,
        metadata: { mode, hasData: false },
      };
    }

    if (!data) {
      return {
        passed: false,
        reason: "No data extracted despite success=true",
        score: 0.2,
        metadata: { mode },
      };
    }

    // Validate expected fields by mode
    let fieldScore = 0;
    let expectedFields = 0;
    let foundFields = 0;

    switch (mode) {
      case "barcode": {
        expectedFields = 3;
        if (typeof data.found === "boolean") foundFields++;
        if (data.type) foundFields++;
        if (data.value || data.codes) foundFields++;
        break;
      }
      case "stock-sheet": {
        expectedFields = 3;
        if (Array.isArray(data.items)) foundFields++;
        if (typeof data.totalItems === "number") foundFields++;
        if (typeof data.confidence === "number") foundFields++;
        break;
      }
      case "invoice": {
        expectedFields = 5;
        if (data.invoiceNumber) foundFields++;
        if (data.supplierName) foundFields++;
        if (typeof data.totalAmount === "number") foundFields++;
        if (Array.isArray(data.lineItems)) foundFields++;
        if (typeof data.confidence === "number") foundFields++;
        break;
      }
    }

    fieldScore = expectedFields > 0 ? foundFields / expectedFields : 0;
    const passed = fieldScore >= 0.6;

    return {
      passed,
      reason: passed
        ? `Extracted ${foundFields}/${expectedFields} expected fields`
        : `Only ${foundFields}/${expectedFields} expected fields found`,
      score: fieldScore,
      metadata: { mode, foundFields, expectedFields },
    };
  },
});

/**
 * Input Validation: Checks that the agent properly rejects invalid inputs.
 */
export const inputValidationEval = agent.createEval("input-validation", {
  description:
    "Verifies the scanner properly handles missing or invalid image data",
  handler: async (_ctx, input, output) => {
    const hasImage = !!(input.imageData || input.imageUrl);

    if (!hasImage) {
      // Should have returned an error
      const passed = output.success === false && typeof output.error === "string";
      return {
        passed,
        reason: passed
          ? "Correctly rejected request with no image"
          : "Should have returned error for missing image",
        score: passed ? 1 : 0,
      };
    }

    // With image, success/failure is valid either way
    return {
      passed: true,
      reason: "Valid input provided, processing result accepted",
      score: 1,
    };
  },
});
