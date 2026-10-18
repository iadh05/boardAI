import { describe, expect, it } from 'vitest';
import {
  BoardEdgeSchema,
  BoardNodeSchema,
  BoardSchema,
  KIND_DEFAULT_LABEL,
  KNOWN_KINDS,
  NODE_KINDS,
} from './board.ts';

const node = (overrides: Record<string, unknown> = {}) => ({
  id: 'n1',
  kind: 'api',
  label: 'Orders API',
  position: { x: 120, y: 80 },
  ...overrides,
});

describe('BoardSchema', () => {
  it('parses a valid board', () => {
    const board = {
      nodes: [node(), node({ id: 'n2', kind: 'database', label: 'Orders DB' })],
      edges: [{ id: 'e1', source: 'n1', target: 'n2' }],
    };

    expect(BoardSchema.parse(board)).toEqual(board);
  });

  it('parses an empty board', () => {
    expect(BoardSchema.parse({ nodes: [], edges: [] })).toEqual({ nodes: [], edges: [] });
  });

  it('rejects a board without edges', () => {
    expect(BoardSchema.safeParse({ nodes: [] }).success).toBe(false);
  });
});

describe('BoardNodeSchema', () => {
  it('accepts every known kind and "custom"', () => {
    for (const kind of [...KNOWN_KINDS, 'custom']) {
      expect(BoardNodeSchema.safeParse(node({ kind })).success).toBe(true);
    }
  });

  it('rejects an unknown kind', () => {
    expect(BoardNodeSchema.safeParse(node({ kind: 'mainframe' })).success).toBe(false);
  });

  it('rejects a node without a label', () => {
    const { label, ...withoutLabel } = node();
    expect(BoardNodeSchema.safeParse(withoutLabel).success).toBe(false);
  });

  it('rejects a label longer than 100 characters', () => {
    expect(BoardNodeSchema.safeParse(node({ label: 'x'.repeat(101) })).success).toBe(false);
  });

  it('rejects a position that is not a pair of finite numbers', () => {
    expect(BoardNodeSchema.safeParse(node({ position: { x: '120', y: 80 } })).success).toBe(false);
    expect(BoardNodeSchema.safeParse(node({ position: { x: Infinity, y: 80 } })).success).toBe(
      false,
    );
  });

  it('rejects an empty id', () => {
    expect(BoardNodeSchema.safeParse(node({ id: '' })).success).toBe(false);
  });
});

describe('BoardEdgeSchema', () => {
  it('rejects an edge without a target', () => {
    expect(BoardEdgeSchema.safeParse({ id: 'e1', source: 'n1' }).success).toBe(false);
  });
});

describe('KIND_DEFAULT_LABEL', () => {
  it('has a non-empty default label for every kind, custom included', () => {
    expect(Object.keys(KIND_DEFAULT_LABEL).sort()).toEqual([...NODE_KINDS].sort());
    for (const label of Object.values(KIND_DEFAULT_LABEL)) {
      expect(label.trim()).not.toBe('');
    }
  });
});
