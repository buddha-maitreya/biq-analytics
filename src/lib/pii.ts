/**
 * PII Detection & Masking — Phase 7.5
 *
 * Regex-based scanner that detects personally identifiable information
 * in LLM outputs and masks it before returning to users.
 *
 * Supported PII types:
 *   - Email addresses
 *   - Phone numbers (intl + local formats)
 *   - Credit card numbers (13-19 digits)
 *   - Social security / national ID numbers
 *   - IP addresses (v4)
 *   - Passport numbers (common formats)
 *
 * All patterns are intentionally broad to minimize false negatives —
 * better to mask a non-PII match than to leak real PII.
 */

// ── PII Pattern Definitions ───────────────────────────────

interface PIIPattern {
  /** Human-readable name for logging/audit */
  name: string;
  /** Regex pattern to detect this PII type */
  pattern: RegExp;
  /** Mask function — replaces the matched text */
  mask: (match: string) => string;
}

const PII_PATTERNS: PIIPattern[] = [
  {
    name: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    mask: (m) => {
      const [local, domain] = m.split("@");
      return `${local[0]}***@${domain}`;
    },
  },
  {
    name: "phone",
    // Matches: +254712345678, (555) 123-4567, 555-123-4567, 0712345678, +1-555-123-4567
    pattern:
      /(?:\+?\d{1,3}[-.\s]?)?\(?\d{2,4}\)?[-.\s]?\d{3,4}[-.\s]?\d{3,4}\b/g,
    mask: (m) => {
      const digits = m.replace(/\D/g, "");
      if (digits.length < 7) return m; // Too short to be a phone number
      return `${m.slice(0, 3)}***${m.slice(-2)}`;
    },
  },
  {
    name: "credit_card",
    // 13-19 digit sequences, possibly separated by spaces or dashes
    pattern: /\b\d{4}[-\s]?\d{4}[-\s]?\d{4}[-\s]?\d{1,7}\b/g,
    mask: (m) => {
      const digits = m.replace(/\D/g, "");
      if (digits.length < 13 || digits.length > 19) return m;
      return `****-****-****-${digits.slice(-4)}`;
    },
  },
  {
    name: "ssn",
    // US SSN format: XXX-XX-XXXX
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    mask: () => "***-**-****",
  },
  {
    name: "ipv4",
    pattern:
      /\b(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    mask: (m) => {
      const parts = m.split(".");
      return `${parts[0]}.${parts[1]}.***.***`;
    },
  },
  {
    name: "passport",
    // Common passport formats: 1-2 letters + 6-9 digits
    pattern: /\b[A-Z]{1,2}\d{6,9}\b/g,
    mask: (m) => `${m.slice(0, 2)}***${m.slice(-2)}`,
  },
];

// ── Public API ─────────────────────────────────────────────

/** Result of a PII scan */
export interface PIIScanResult {
  /** Whether any PII was detected */
  hasPII: boolean;
  /** Count of detections per PII type */
  detections: Record<string, number>;
  /** Total number of PII matches */
  totalMatches: number;
}

/**
 * Scan text for PII patterns without modifying it.
 * Use this for detection/logging before deciding whether to mask.
 */
export function scanForPII(text: string): PIIScanResult {
  const detections: Record<string, number> = {};
  let totalMatches = 0;

  for (const { name, pattern } of PII_PATTERNS) {
    // Reset regex lastIndex for global patterns
    pattern.lastIndex = 0;
    const matches = text.match(pattern);
    if (matches?.length) {
      detections[name] = matches.length;
      totalMatches += matches.length;
    }
  }

  return {
    hasPII: totalMatches > 0,
    detections,
    totalMatches,
  };
}

/**
 * Mask all detected PII in the given text.
 * Returns the masked text and scan results.
 */
export function maskPII(text: string): { masked: string; scan: PIIScanResult } {
  const scan = scanForPII(text);
  if (!scan.hasPII) return { masked: text, scan };

  let result = text;
  for (const { pattern, mask } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    result = result.replace(pattern, mask);
  }

  return { masked: result, scan };
}

/**
 * Lightweight check — returns true if any PII is present.
 * Faster than full scan when you only need a boolean.
 */
export function containsPII(text: string): boolean {
  for (const { pattern } of PII_PATTERNS) {
    pattern.lastIndex = 0;
    if (pattern.test(text)) return true;
  }
  return false;
}
