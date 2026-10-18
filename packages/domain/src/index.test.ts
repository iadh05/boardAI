import { describe, expect, it } from 'vitest';
import { PRODUCT_NAME } from './index.ts';

describe('@designroom/domain public API', () => {
  it('exposes the product name', () => {
    expect(PRODUCT_NAME).toBe('DesignRoom');
  });
});
