/**
 * Pagination Tests — validates paginate() and offset() helpers
 */
import { describe, expect, test } from "bun:test";
import { paginate, offset, type PaginationParams } from "../src/lib/pagination";

describe("paginate", () => {
  const defaults: PaginationParams = { page: 1, limit: 20, sortOrder: "desc" };

  test("returns correct pagination metadata for first page", () => {
    const result = paginate(["a", "b", "c"], 50, { ...defaults, page: 1, limit: 10 });
    expect(result.pagination).toEqual({
      page: 1,
      limit: 10,
      total: 50,
      totalPages: 5,
      hasNext: true,
      hasPrev: false,
    });
    expect(result.data).toEqual(["a", "b", "c"]);
  });

  test("returns correct pagination metadata for last page", () => {
    const result = paginate(["x"], 21, { ...defaults, page: 3, limit: 10 });
    expect(result.pagination.hasNext).toBe(false);
    expect(result.pagination.hasPrev).toBe(true);
    expect(result.pagination.totalPages).toBe(3);
  });

  test("handles single page", () => {
    const result = paginate([1, 2], 2, { ...defaults, page: 1, limit: 20 });
    expect(result.pagination.totalPages).toBe(1);
    expect(result.pagination.hasNext).toBe(false);
    expect(result.pagination.hasPrev).toBe(false);
  });

  test("handles empty data", () => {
    const result = paginate([], 0, defaults);
    expect(result.pagination.totalPages).toBe(0);
    expect(result.pagination.hasNext).toBe(false);
    expect(result.pagination.hasPrev).toBe(false);
    expect(result.data).toEqual([]);
  });

  test("handles middle page", () => {
    const result = paginate(["mid"], 100, { ...defaults, page: 5, limit: 10 });
    expect(result.pagination.hasNext).toBe(true);
    expect(result.pagination.hasPrev).toBe(true);
    expect(result.pagination.page).toBe(5);
  });
});

describe("offset", () => {
  test("calculates offset for page 1", () => {
    expect(offset({ page: 1, limit: 20, sortOrder: "desc" })).toBe(0);
  });

  test("calculates offset for page 2", () => {
    expect(offset({ page: 2, limit: 20, sortOrder: "desc" })).toBe(20);
  });

  test("calculates offset for page 5 with limit 10", () => {
    expect(offset({ page: 5, limit: 10, sortOrder: "desc" })).toBe(40);
  });
});
