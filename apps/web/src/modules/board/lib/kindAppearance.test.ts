import { SHAPES } from '@designroom/diagram';
import { NODE_KINDS } from '@designroom/domain';
import { describe, expect, it } from 'vitest';
import { KIND_COLOR, KIND_ICON, KIND_SHAPE, TOOLBAR_KINDS } from './kindAppearance.ts';

describe('KIND_ICON', () => {
  it('gives every kind a different icon, so boxes are told apart at a glance', () => {
    const icons = new Set(NODE_KINDS.map((kind) => KIND_ICON[kind]));
    expect(icons.size).toBe(NODE_KINDS.length);
  });
});

describe('KIND_SHAPE', () => {
  it('gives every kind a diagram shape', () => {
    for (const kind of NODE_KINDS) expect(SHAPES).toContain(KIND_SHAPE[kind]);
  });

  it('draws storage as cylinders and anything custom as a dashed box', () => {
    expect(KIND_SHAPE.database).toBe('cylinder');
    expect(KIND_SHAPE.custom).toBe('dashed');
  });
});

describe('KIND_COLOR', () => {
  it('colours every kind from a theme token, Custom in a neutral one', () => {
    for (const kind of NODE_KINDS) expect(KIND_COLOR[kind]).toMatch(/^var\(--color-[\w-]+\)$/);
    expect(KIND_COLOR.custom).toBe('var(--color-muted)');
  });
});

describe('TOOLBAR_KINDS', () => {
  it('lists every kind once, with Custom last', () => {
    expect([...TOOLBAR_KINDS].sort()).toEqual([...NODE_KINDS].sort());
    expect(TOOLBAR_KINDS.at(-1)).toBe('custom');
  });
});
