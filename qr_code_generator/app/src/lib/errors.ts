import type { Context } from "hono";

export class ValidationError extends Error {
  readonly status = 422;
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  readonly status = 404;
  constructor(message = "Not Found") {
    super(message);
    this.name = "NotFoundError";
  }
}

export class GoneError extends Error {
  readonly status = 410;
  constructor(message = "Gone") {
    super(message);
    this.name = "GoneError";
  }
}

type AppError = ValidationError | NotFoundError | GoneError;

function isAppError(err: unknown): err is AppError {
  return err instanceof ValidationError || err instanceof NotFoundError || err instanceof GoneError;
}

export function errorHandler(err: Error, c: Context): Response {
  if (isAppError(err)) {
    return c.json({ error: err.message }, err.status);
  }
  if (process.env.NODE_ENV !== "test") {
    console.error("Unhandled error:", err);
  }
  return c.json({ error: "Internal Server Error" }, 500);
}
