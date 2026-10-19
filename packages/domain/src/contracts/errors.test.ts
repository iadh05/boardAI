import { describe, expect, it } from 'vitest';
import { ErrorResponseSchema } from './errors.ts';

describe('ErrorResponseSchema', () => {
  it('accepts the API’s one error shape, with or without details', () => {
    expect(
      ErrorResponseSchema.parse({ error: { code: 'BOARD_TOO_LARGE', message: 'Too large.' } }),
    ).toEqual({ error: { code: 'BOARD_TOO_LARGE', message: 'Too large.' } });
    expect(
      ErrorResponseSchema.safeParse({
        error: { code: 'VALIDATION_FAILED', message: 'Invalid.', details: [{ path: 'messages' }] },
      }).success,
    ).toBe(true);
  });

  it('rejects anything else', () => {
    expect(ErrorResponseSchema.safeParse({ message: 'nope' }).success).toBe(false);
    expect(ErrorResponseSchema.safeParse('<html>413</html>').success).toBe(false);
  });
});
