/**
 * The backend could not be reached or is overloaded: worth waiting and retrying, and the case
 * where a job may fall back to the local backend. Anything else (a 4xx, a malformed reply) is a
 * configuration or protocol problem that retrying will not fix, so it is thrown as a plain Error.
 */
export class ProviderUnavailableError extends Error {
  override name = 'ProviderUnavailableError';
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
  }
}

/** 408 and 429 are transient by definition; 5xx means the server (or a proxy in front of it) is unwell. */
export function isTransientStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}
