import { afterEach, describe, expect, it, vi } from 'vitest';
import { createId } from './ids.ts';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('createId', () => {
  it('returns a v4 UUID', () => {
    expect(createId()).toMatch(UUID_V4);
  });

  it('returns a different id each time', () => {
    expect(createId()).not.toBe(createId());
  });

  it('still works where crypto.randomUUID is missing (plain http on a LAN address)', () => {
    vi.stubGlobal('crypto', { getRandomValues: crypto.getRandomValues.bind(crypto) });

    expect(createId()).toMatch(UUID_V4);
  });
});
