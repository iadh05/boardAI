import { NODE_KINDS } from '@designroom/domain';
import { describe, expect, it } from 'vitest';
import { KIND_ICON, TOOLBAR_KINDS } from './kindIcon.ts';

describe('KIND_ICON', () => {
  it('gives every kind a different icon, so boxes are told apart at a glance', () => {
    const icons = new Set(NODE_KINDS.map((kind) => KIND_ICON[kind]));
    expect(icons.size).toBe(NODE_KINDS.length);
  });
});

describe('TOOLBAR_KINDS', () => {
  it('lists every kind once, with Custom last', () => {
    expect([...TOOLBAR_KINDS].sort()).toEqual([...NODE_KINDS].sort());
    expect(TOOLBAR_KINDS.at(-1)).toBe('custom');
  });
});
