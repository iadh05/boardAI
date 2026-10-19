// Failures talking to an LLM. They are I/O failures, so they are thrown (docs/rules/general.md),
// but typed: the caller maps `code` to what the user sees, the gateway uses `transient` to retry.

export type LlmErrorCode =
  | 'UNAVAILABLE' // can't connect, 5xx, 429: try again later
  | 'TIMEOUT' // no chunk for too long
  | 'BAD_REQUEST' // 4xx: retrying won't help (wrong model name, bad request)
  | 'BAD_RESPONSE' // the provider sent something we can't read
  | 'ABORTED'; // the caller cancelled

const TRANSIENT: ReadonlySet<LlmErrorCode> = new Set(['UNAVAILABLE', 'TIMEOUT']);

export class LlmError extends Error {
  override readonly name = 'LlmError';
  readonly code: LlmErrorCode;

  constructor(code: LlmErrorCode, message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.code = code;
  }

  /** Worth retrying: the same request may work a moment later. */
  get transient(): boolean {
    return TRANSIENT.has(this.code);
  }
}
