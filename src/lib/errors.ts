/**
 * Error handling infrastructure for Business IQ Enterprise.
 *
 * Architecture:
 * - Error classes for domain-specific errors (NotFound, Validation, Conflict, etc.)
 * - Hono middleware that catches all route errors and returns structured JSON
 * - Zod error transformer for user-friendly validation messages
 * - Database error interpreter for constraint violations
 * - Structured JSON error response format with debug info in dev mode
 *
 * Usage in routes:
 *   router.use(errorMiddleware());            // auto-catch everything
 *   router.onError((err, c) => sendError(c, err)); // hono onError hook
 *   throw new NotFoundError("Product", id);   // from service code — caught by middleware
 */

import type { Context, Next } from "hono";
import { ZodError } from "zod";

// ═══════════════════════════════════════════════════════════════
// Error Classes
// ═══════════════════════════════════════════════════════════════

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(entity: string, id?: string) {
    super(
      id ? `${entity} with id '${id}' not found` : `${entity} not found`,
      "NOT_FOUND",
      404,
    );
    this.name = "NotFoundError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "VALIDATION_ERROR", 400, details);
    this.name = "ValidationError";
  }
}

export class ConflictError extends AppError {
  constructor(message: string) {
    super(message, "CONFLICT", 409);
    this.name = "ConflictError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super(message, "UNAUTHORIZED", 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Forbidden") {
    super(message, "FORBIDDEN", 403);
    this.name = "ForbiddenError";
  }
}

export class InsufficientStockError extends AppError {
  constructor(productId: string, requested: number, available: number) {
    super(
      `Insufficient stock for product '${productId}': requested ${requested}, available ${available}`,
      "INSUFFICIENT_STOCK",
      409,
      { productId, requested, available },
    );
    this.name = "InsufficientStockError";
  }
}

export class DatabaseError extends AppError {
  constructor(message: string, details?: Record<string, unknown>) {
    super(message, "DATABASE_ERROR", 500, details);
    this.name = "DatabaseError";
  }
}

// ═══════════════════════════════════════════════════════════════
// Error Transformers
// ═══════════════════════════════════════════════════════════════

/** Parse a ZodError into a user-friendly message and per-field breakdown. */
function formatZodError(err: ZodError): {
  message: string;
  fieldErrors: Record<string, string[]>;
} {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of err.issues) {
    const path = issue.path.join(".") || "_root";
    if (!fieldErrors[path]) fieldErrors[path] = [];
    fieldErrors[path].push(issue.message);
  }

  const fields = Object.keys(fieldErrors);
  const message =
    fields.length === 1
      ? `Validation failed: ${fieldErrors[fields[0]].join(", ")}`
      : `Validation failed on ${fields.length} field(s): ${fields.join(", ")}`;

  return { message, fieldErrors };
}

/** Interpret common Postgres errors into domain errors. */
function interpretDbError(err: Error): AppError {
  const msg = err.message;

  if (msg.includes("unique constraint") || msg.includes("duplicate key")) {
    const match = msg.match(/Key \((.+?)\)=/);
    const field = match?.[1] ?? "unknown field";
    return new ConflictError(`Duplicate value for ${field}`);
  }
  if (msg.includes("foreign key constraint")) {
    return new ValidationError("Referenced record does not exist");
  }
  if (msg.includes("not-null constraint")) {
    const match = msg.match(/column "(.+?)"/);
    return new ValidationError(`${match?.[1] ?? "Field"} is required`);
  }
  if (
    msg.includes("ECONNREFUSED") ||
    msg.includes("connection terminated") ||
    msg.includes("Connection terminated")
  ) {
    return new DatabaseError("Database connection error — please retry", {
      originalMessage: msg,
    });
  }

  return new DatabaseError(msg);
}

// ═══════════════════════════════════════════════════════════════
// Structured Error Response Builder
// ═══════════════════════════════════════════════════════════════

interface ErrorResponseBody {
  success: false;
  error: {
    message: string;
    code: string;
    statusCode: number;
    details?: Record<string, unknown>;
    timestamp: string;
    stack?: string;
  };
}

function buildErrorResponse(
  err: unknown,
  isDev: boolean,
): { body: ErrorResponseBody; status: number } {
  const timestamp = new Date().toISOString();

  // Zod validation error
  if (err instanceof ZodError) {
    const { message, fieldErrors } = formatZodError(err);
    return {
      body: {
        success: false,
        error: {
          message,
          code: "VALIDATION_ERROR",
          statusCode: 400,
          details: { fieldErrors },
          timestamp,
        },
      },
      status: 400,
    };
  }

  // Known application error
  if (err instanceof AppError) {
    return {
      body: {
        success: false,
        error: {
          message: err.message,
          code: err.code,
          statusCode: err.statusCode,
          details: err.details,
          timestamp,
          ...(isDev && { stack: err.stack }),
        },
      },
      status: err.statusCode,
    };
  }

  // Postgres / DB constraint error
  if (
    err instanceof Error &&
    (err.message.includes("constraint") ||
      err.message.includes("ECONN") ||
      err.message.includes("Connection"))
  ) {
    const appErr = interpretDbError(err);
    return buildErrorResponse(appErr, isDev);
  }

  // Unknown / unexpected error
  const message = err instanceof Error ? err.message : String(err);
  return {
    body: {
      success: false,
      error: {
        message: isDev ? message : "Internal server error",
        code: "INTERNAL_ERROR",
        statusCode: 500,
        timestamp,
        ...(isDev && err instanceof Error && { stack: err.stack }),
      },
    },
    status: 500,
  };
}

// ═══════════════════════════════════════════════════════════════
// Hono Middleware — catches all unhandled route errors
// ═══════════════════════════════════════════════════════════════

/**
 * Error-handling middleware for Hono routers.
 *
 * Mount at the router level to catch every thrown error automatically:
 * ```ts
 * const router = createRouter();
 * router.use(errorMiddleware());
 * ```
 */
export function errorMiddleware() {
  return async (c: Context, next: Next) => {
    try {
      await next();
    } catch (err) {
      const isDev = process.env.NODE_ENV !== "production";
      const { body, status } = buildErrorResponse(err, isDev);

      // Log with structured context
      const logger = (c.var as Record<string, unknown>).logger as
        | { error: (...args: unknown[]) => void }
        | undefined;

      if (logger) {
        logger.error(`[${body.error.code}] ${body.error.message}`, {
          statusCode: status,
          path: c.req.path,
          method: c.req.method,
          ...(body.error.details && { details: body.error.details }),
        });
      }

      return c.json(body, status as Parameters<typeof c.json>[1]);
    }
  };
}

// ═══════════════════════════════════════════════════════════════
// Hono onError handler — alternative to middleware
// ═══════════════════════════════════════════════════════════════

/**
 * Hono `onError` handler for use with `router.onError()`.
 *
 * ```ts
 * const router = createRouter();
 * router.onError(onRouteError);
 * ```
 */
export function onRouteError(err: Error, c: Context) {
  const isDev = process.env.NODE_ENV !== "production";
  const { body, status } = buildErrorResponse(err, isDev);
  return c.json(body, status as Parameters<typeof c.json>[1]);
}

// ═══════════════════════════════════════════════════════════════
// Utility: Manual error response
// ═══════════════════════════════════════════════════════════════

/** Send a structured error response from a catch block. */
export function sendError(c: Context, err: unknown) {
  const isDev = process.env.NODE_ENV !== "production";
  const { body, status } = buildErrorResponse(err, isDev);
  return c.json(body, status as Parameters<typeof c.json>[1]);
}

/** Convert any thrown value to an AppError (useful in agents). */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof ZodError) {
    const { message, fieldErrors } = formatZodError(err);
    return new ValidationError(message, { fieldErrors });
  }
  if (err instanceof Error) {
    if (
      err.message.includes("constraint") ||
      err.message.includes("ECONN")
    ) {
      return interpretDbError(err);
    }
    return new AppError(err.message, "INTERNAL_ERROR", 500);
  }
  return new AppError(String(err), "INTERNAL_ERROR", 500);
}
