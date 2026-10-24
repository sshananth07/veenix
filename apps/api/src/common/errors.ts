export class AppError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 422,
    readonly details?: unknown,
  ) {
    super(message);
  }
}

/** A business rule refused the action. The message is shown to the user as is. */
export const rule = (message: string) => new AppError("RULE", message, 422);
export const notFound = (what = "Record") => new AppError("NOT_FOUND", `${what} not found`, 404);
export const forbidden = (message = "Your role cannot do this") => new AppError("FORBIDDEN", message, 403);
export const unauthenticated = (code = "UNAUTHENTICATED", message = "Sign in required") => new AppError(code, message, 401);
