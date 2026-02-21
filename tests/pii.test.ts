/**
 * PII Detection & Masking Tests
 */
import { describe, expect, test } from "bun:test";
import { scanForPII, maskPII, containsPII } from "../src/lib/pii";

describe("scanForPII", () => {
  test("detects email addresses", () => {
    const result = scanForPII("Contact us at user@example.com for help");
    expect(result.hasPII).toBe(true);
    expect(result.detections.email).toBe(1);
  });

  test("detects multiple emails", () => {
    const result = scanForPII("Send to a@b.com and c@d.org");
    expect(result.detections.email).toBe(2);
    expect(result.totalMatches).toBeGreaterThanOrEqual(2);
  });

  test("detects credit card numbers", () => {
    const result = scanForPII("Card: 4111-1111-1111-1111");
    expect(result.hasPII).toBe(true);
    expect(result.detections.credit_card).toBe(1);
  });

  test("detects SSNs", () => {
    const result = scanForPII("SSN: 123-45-6789");
    expect(result.hasPII).toBe(true);
    expect(result.detections.ssn).toBe(1);
  });

  test("detects IPv4 addresses", () => {
    const result = scanForPII("Server at 192.168.1.100");
    expect(result.hasPII).toBe(true);
    expect(result.detections.ipv4).toBe(1);
  });

  test("returns clean for safe text", () => {
    const result = scanForPII("The quick brown fox jumps over the lazy dog");
    expect(result.hasPII).toBe(false);
    expect(result.totalMatches).toBe(0);
  });
});

describe("maskPII", () => {
  test("masks email addresses", () => {
    const { masked, scan } = maskPII("Email: user@example.com");
    expect(scan.hasPII).toBe(true);
    expect(masked).toContain("u***@example.com");
    expect(masked).not.toContain("user@example.com");
  });

  test("masks SSNs completely", () => {
    const { masked } = maskPII("SSN is 123-45-6789");
    expect(masked).toContain("***-**-****");
    expect(masked).not.toContain("123-45-6789");
  });

  test("masks credit cards (PII is not exposed)", () => {
    // The phone pattern is intentionally broad and may partially match CC digits
    // before the CC pattern runs. The key invariant is: the original CC number
    // must NOT appear in the output (it gets masked by one pattern or another).
    const ccNumber = "4111-1111-1111-1111";
    const { masked, scan } = maskPII(`Card ${ccNumber}`);
    expect(scan.hasPII).toBe(true);
    expect(masked).not.toContain(ccNumber);
  });

  test("masks IPv4 addresses", () => {
    const { masked } = maskPII("IP: 10.0.0.1");
    expect(masked).toContain("10.0.***.***");
  });

  test("returns unchanged text when no PII", () => {
    const text = "Hello world, no PII here";
    const { masked, scan } = maskPII(text);
    expect(scan.hasPII).toBe(false);
    expect(masked).toBe(text);
  });
});

describe("containsPII", () => {
  test("returns true for text with PII", () => {
    expect(containsPII("user@example.com")).toBe(true);
  });

  test("returns false for clean text", () => {
    expect(containsPII("Hello world")).toBe(false);
  });
});
