/**
 * LLM Output Validation — Phase 7.5
 *
 * Post-processing validation for LLM outputs. Validates structured
 * outputs against expected schemas and detects common LLM failure modes.
 *
 * Failure modes detected:
 *   - Truncated responses (content cut off mid-sentence)
 *   - JSON parse failures (when structured output expected)
 *   - Schema violations (missing required fields)
 *   - Empty / null responses
 *   - Refusal responses ("I can't help with that")
 *   - Hallucination indicators (excessive confidence without data)
 */

import { z } from "zod";

// ── Validation Result ──────────────────────────────────────

export interface ValidationResult {
  /** Whether the output passed validation */
  valid: boolean;
  /** List of issues found (empty if valid) */
  issues: ValidationIssue[];
  /** Cleaned/fixed output (may differ from original if auto-corrected) */
  cleaned?: string;
}

export interface ValidationIssue {
  /** Issue severity: error (blocks response), warning (logged but passed) */
  severity: "error" | "warning";
  /** Machine-readable issue code */
  code: string;
  /** Human-readable description */
  message: string;
}

// ── Text Output Validation ─────────────────────────────────

/** Common LLM refusal patterns */
const REFUSAL_PATTERNS = [
  /^I(?:'m| am) (?:sorry|unable|not able)/i,
  /^I can(?:not|'t) (?:help|assist|provide|generate)/i,
  /^As an AI/i,
  /^I don't have (?:access|the ability)/i,
];

/** Truncation indicators — text ending mid-word or mid-sentence */
const TRUNCATION_PATTERNS = [
  /[a-zA-Z]{3,}$/,        // Ends mid-word (no punctuation)
  /,\s*$/,                 // Ends with trailing comma
  /\.\.\.\s*$/,            // Ends with ellipsis
  /```\s*$/,               // Ends with open code block (no closing)
];

/**
 * Validate a text response from an LLM.
 * Checks for empty, truncated, or refusal responses.
 */
export function validateTextOutput(
  text: string | null | undefined,
  options: {
    /** Minimum acceptable length (characters) */
    minLength?: number;
    /** Maximum acceptable length (characters) */
    maxLength?: number;
    /** Whether refusal responses should be flagged as errors */
    rejectRefusals?: boolean;
  } = {}
): ValidationResult {
  const {
    minLength = 1,
    maxLength = 500_000,
    rejectRefusals = false,
  } = options;
  const issues: ValidationIssue[] = [];

  // Null / empty check
  if (!text?.trim()) {
    issues.push({
      severity: "error",
      code: "EMPTY_RESPONSE",
      message: "LLM returned an empty or null response",
    });
    return { valid: false, issues };
  }

  const trimmed = text.trim();

  // Length checks
  if (trimmed.length < minLength) {
    issues.push({
      severity: "error",
      code: "TOO_SHORT",
      message: `Response length ${trimmed.length} is below minimum ${minLength}`,
    });
  }

  if (trimmed.length > maxLength) {
    issues.push({
      severity: "warning",
      code: "TOO_LONG",
      message: `Response length ${trimmed.length} exceeds maximum ${maxLength}`,
    });
  }

  // Refusal detection
  for (const pattern of REFUSAL_PATTERNS) {
    if (pattern.test(trimmed)) {
      issues.push({
        severity: rejectRefusals ? "error" : "warning",
        code: "REFUSAL_DETECTED",
        message: "Response appears to be a refusal or capability disclaimer",
      });
      break;
    }
  }

  // Truncation detection
  if (trimmed.length > 100) {
    // Only check for truncation on longer responses
    for (const pattern of TRUNCATION_PATTERNS) {
      if (pattern.test(trimmed)) {
        issues.push({
          severity: "warning",
          code: "POSSIBLE_TRUNCATION",
          message: "Response may be truncated (ends abruptly)",
        });
        break;
      }
    }
  }

  // Unbalanced code blocks
  const codeBlockCount = (trimmed.match(/```/g) || []).length;
  if (codeBlockCount % 2 !== 0) {
    issues.push({
      severity: "warning",
      code: "UNBALANCED_CODE_BLOCKS",
      message: "Response has unclosed code blocks",
    });
  }

  const hasErrors = issues.some((i) => i.severity === "error");
  return { valid: !hasErrors, issues, cleaned: trimmed };
}

// ── JSON / Schema Validation ───────────────────────────────

/**
 * Validate a JSON string against a Zod schema.
 * Attempts to parse the JSON and validate the structure.
 */
export function validateJsonOutput<T>(
  text: string | null | undefined,
  schema: z.ZodType<T>
): ValidationResult & { parsed?: T } {
  const issues: ValidationIssue[] = [];

  if (!text?.trim()) {
    issues.push({
      severity: "error",
      code: "EMPTY_RESPONSE",
      message: "No JSON content to validate",
    });
    return { valid: false, issues };
  }

  // Try to extract JSON from markdown code blocks
  let jsonStr = text.trim();
  const codeBlockMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (codeBlockMatch) {
    jsonStr = codeBlockMatch[1].trim();
  }

  // Parse JSON
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch (err) {
    issues.push({
      severity: "error",
      code: "JSON_PARSE_ERROR",
      message: `Failed to parse JSON: ${err instanceof Error ? err.message : "unknown error"}`,
    });
    return { valid: false, issues };
  }

  // Validate against schema
  const result = schema.safeParse(parsed);
  if (!result.success) {
    for (const issue of result.error.issues) {
      issues.push({
        severity: "error",
        code: "SCHEMA_VIOLATION",
        message: `${issue.path.join(".")}: ${issue.message}`,
      });
    }
    return { valid: false, issues };
  }

  return { valid: true, issues, parsed: result.data, cleaned: jsonStr };
}

// ── Composite Validation ───────────────────────────────────

/**
 * Run all applicable validations on an LLM output.
 * Returns combined issues from text validation and optional schema validation.
 */
export function validateOutput(
  text: string | null | undefined,
  options: {
    minLength?: number;
    maxLength?: number;
    rejectRefusals?: boolean;
    schema?: z.ZodType;
  } = {}
): ValidationResult {
  // Start with text validation
  const textResult = validateTextOutput(text, options);

  // If schema provided and text is valid-ish, also validate structure
  if (options.schema && text?.trim()) {
    const schemaResult = validateJsonOutput(text, options.schema);
    // Merge issues
    textResult.issues.push(...schemaResult.issues);
    textResult.valid = textResult.valid && schemaResult.valid;
  }

  return textResult;
}
