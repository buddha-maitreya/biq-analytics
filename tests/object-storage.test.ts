/**
 * Object Storage Abstraction Tests
 *
 * Tests the public API surface of the object-storage module.
 * Since S3 credentials are not available in test environments,
 * these tests verify the availability check and namespace helpers.
 */
import { describe, expect, test, beforeEach, afterEach } from "bun:test";
import { isAvailable, namespace } from "../src/services/object-storage";

describe("isAvailable", () => {
  const origEnv = { ...process.env };

  afterEach(() => {
    // Restore env vars
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ENDPOINT;
  });

  test("returns false when no S3 env vars set", () => {
    delete process.env.S3_ACCESS_KEY_ID;
    delete process.env.S3_BUCKET;
    delete process.env.S3_ENDPOINT;
    expect(isAvailable()).toBe(false);
  });

  test("returns true when S3_BUCKET is set", () => {
    process.env.S3_BUCKET = "test-bucket";
    expect(isAvailable()).toBe(true);
  });

  test("returns true when S3_ACCESS_KEY_ID is set", () => {
    process.env.S3_ACCESS_KEY_ID = "AKIATEST";
    expect(isAvailable()).toBe(true);
  });

  test("returns true when S3_ENDPOINT is set", () => {
    process.env.S3_ENDPOINT = "https://s3.example.com";
    expect(isAvailable()).toBe(true);
  });
});

describe("namespace", () => {
  test("creates namespace with trailing slash", () => {
    const ns = namespace("my-prefix");
    expect(ns.prefix).toBe("my-prefix/");
  });

  test("does not double-slash if prefix already ends with /", () => {
    const ns = namespace("my-prefix/");
    expect(ns.prefix).toBe("my-prefix/");
  });

  test("namespace exposes all CRUD methods", () => {
    const ns = namespace("test");
    expect(typeof ns.put).toBe("function");
    expect(typeof ns.get).toBe("function");
    expect(typeof ns.getBuffer).toBe("function");
    expect(typeof ns.getMeta).toBe("function");
    expect(typeof ns.exists).toBe("function");
    expect(typeof ns.stat).toBe("function");
    expect(typeof ns.del).toBe("function");
    expect(typeof ns.presign).toBe("function");
    expect(typeof ns.list).toBe("function");
  });
});
