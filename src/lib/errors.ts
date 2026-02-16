/**
 * Shared error types for agents and routes.
 */

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 500,
    public readonly details?: Record<string, unknown>
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
      404
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
      { productId, requested, available }
    );
    this.name = "InsufficientStockError";
  }
}

/**
 * Convert any thrown value to an AppError.
 */
export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error)
    return new AppError(err.message, "INTERNAL_ERROR", 500);
  return new AppError(String(err), "INTERNAL_ERROR", 500);
}
