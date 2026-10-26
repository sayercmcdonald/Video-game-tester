// Errors that are safe to show to users. Anything else is logged and shown
// as a generic message so internals never leak.

export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: "NOT_FOUND" | "FORBIDDEN" | "UNAUTHENTICATED" | "INVALID" | "CONFLICT" | "UNAVAILABLE",
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * Used whenever a record is missing OR belongs to someone the user may not see.
 * Returning the same answer for both prevents probing for other churches' IDs.
 */
export function notFound(what = "Record"): AppError {
  return new AppError(`${what} not found.`, "NOT_FOUND");
}

export function forbidden(message = "You don't have permission to do that."): AppError {
  return new AppError(message, "FORBIDDEN");
}

export function invalid(message: string): AppError {
  return new AppError(message, "INVALID");
}

export function conflict(message: string): AppError {
  return new AppError(message, "CONFLICT");
}
