import { describe, expect, it } from 'vitest';
import { createIdRewriter } from './idRewriter.ts';

const labels: Record<string, string> = {
  n10: 'Payment Service',
  n11: 'Notifications',
  n13: 'Event stream (Kafka)',
};
const rewrite = (...chunks: string[]) => {
  const rewriter = createIdRewriter((id) => labels[id]);
  return chunks.map((c) => rewriter.feed(c)).join('') + rewriter.flush();
};

describe('ids rewritten to labels (M1-29)', () => {
  it('a bare id becomes the box’s name', () => {
    expect(rewrite('Connect n11 to the stream.')).toBe('Connect Notifications to the stream.');
  });

  it('an id in parentheses after the name is dropped: the name is already there', () => {
    expect(rewrite('The Payment Service (`n10`) must be idempotent.')).toBe(
      'The Payment Service must be idempotent.',
    );
    expect(rewrite('Kafka (n13) stays.')).toBe('Kafka stays.');
  });

  it('backticks around an id go with it', () => {
    expect(rewrite('Update `n10` first.')).toBe('Update Payment Service first.');
  });

  it('an id split across chunks is still rewritten', () => {
    expect(rewrite('Connect n', '1', '1 to Kafka.')).toBe('Connect Notifications to Kafka.');
    expect(rewrite('Kafka (`n1', '3`) stays.')).toBe('Kafka stays.');
  });

  it('text is held back only while it could still be an id', () => {
    const rewriter = createIdRewriter((id) => labels[id]);
    expect(rewriter.feed('Kafka is in')).toBe('Kafka is in'); // "in" is a word, not an id
    expect(rewriter.feed(' place, see n')).toBe(' place, see ');
    expect(rewriter.feed('10.')).toBe('Payment Service.');
  });

  it('unknown ids and look-alikes are left alone', () => {
    expect(rewrite('n99 is not on the board; neither is an10 or n3x.')).toBe(
      'n99 is not on the board; neither is an10 or n3x.',
    );
  });

  it('flush releases what was held at the end', () => {
    expect(rewrite('ends with n1')).toBe('ends with n1'); // n1 unknown here: kept as is
    expect(rewrite('ends with n10')).toBe('ends with Payment Service');
  });
});
