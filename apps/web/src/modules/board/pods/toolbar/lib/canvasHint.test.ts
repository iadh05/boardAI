import { describe, expect, it } from 'vitest';
import { canvasHint } from './canvasHint.ts';

describe('canvasHint', () => {
  it('guides the first steps, then steps aside once the first arrow is drawn', () => {
    expect(canvasHint({ nodes: 0, edges: 0 })).toMatch(/add a component/i);
    expect(canvasHint({ nodes: 1, edges: 0 })).toMatch(/add another/i);
    expect(canvasHint({ nodes: 2, edges: 0 })).toMatch(/drag from a dot/i);
    expect(canvasHint({ nodes: 2, edges: 1 })).toBeNull();
  });
});
