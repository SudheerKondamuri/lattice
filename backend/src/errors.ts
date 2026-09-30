export class AppError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
    public details?: unknown,
  ) {
    super(message);
  }
}
export function required<T>(value: T | null | undefined, message = 'Resource not found'): T {
  if (value === null || value === undefined) throw new AppError('NOT_FOUND', message, 404);
  return value;
}
export function configured(value: string | undefined, name: string): string {
  if (!value) throw new AppError('CONFIGURATION_ERROR', `${name} must be configured`, 503);
  return value;
}
export function publicError(error: unknown) {
  return error instanceof AppError
    ? { code: error.code, message: error.message }
    : { code: 'INTERNAL_ERROR', message: 'Operation failed; contact support with the request ID.' };
}
