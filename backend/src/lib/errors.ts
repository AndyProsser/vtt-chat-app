export type ErrorCode =
  | 'invalid_input'
  | 'email_taken'
  | 'consent_required'
  | 'invalid_credentials'
  | 'invalid_token'
  | 'session_invalid'
  | 'forbidden'
  | 'not_found'
  | 'invite_invalid'
  | 'conflict'
  | 'dm_must_transfer';

/** An expected, reportable failure (as opposed to a bug). The HTTP layer maps `code` to a status. */
export class DomainError extends Error {
  constructor(
    readonly code: ErrorCode,
    message: string = code,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
