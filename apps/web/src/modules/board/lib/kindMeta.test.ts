import { KIND_DEFAULT_LABEL, NODE_KINDS } from '@designroom/domain';
import { describe, expect, it } from 'vitest';
import { KIND_META, TOOLBAR_KINDS } from './kindMeta.ts';

describe('KIND_META', () => {
  it('has an icon and a name for every kind', () => {
    for (const kind of NODE_KINDS) {
      expect(KIND_META[kind].icon).toBeDefined();
      expect(KIND_META[kind].name).toBe(KIND_DEFAULT_LABEL[kind]);
    }
  });

  it('gives every kind a different icon, so boxes are told apart at a glance', () => {
    const icons = new Set(NODE_KINDS.map((kind) => KIND_META[kind].icon));
    expect(icons.size).toBe(NODE_KINDS.length);
  });
});

describe('TOOLBAR_KINDS', () => {
  it('lists every kind once, with Custom last', () => {
    expect([...TOOLBAR_KINDS].sort()).toEqual([...NODE_KINDS].sort());
    expect(TOOLBAR_KINDS.at(-1)).toBe('custom');
  });
});
