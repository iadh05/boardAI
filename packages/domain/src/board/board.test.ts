import { describe, expect, it } from 'vitest';
import {
  BoardEdgeSchema,
  BoardNodeSchema,
  BoardSchema,
  KIND_DEFAULT_LABEL,
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

  const edge = (id: string, source: string, target: string) => ({ id, source, target });
  const twoNodes = [node(), node({ id: 'n2' })];

  it('rejects two nodes with the same id', () => {
    expect(BoardSchema.safeParse({ nodes: [node(), node()], edges: [] }).success).toBe(false);
  });

  it('rejects two edges with the same id', () => {
    const edges = [edge('e1', 'n1', 'n2'), edge('e1', 'n2', 'n1')];
    expect(BoardSchema.safeParse({ nodes: twoNodes, edges }).success).toBe(false);
  });

  it('rejects an edge whose source or target is not on the board', () => {
    expect(
      BoardSchema.safeParse({ nodes: twoNodes, edges: [edge('e1', 'n1', 'n9')] }).success,
    ).toBe(false);
    expect(
      BoardSchema.safeParse({ nodes: twoNodes, edges: [edge('e1', 'n9', 'n1')] }).success,
    ).toBe(false);
  });

  it('rejects an edge from a node to itself', () => {
    expect(
      BoardSchema.safeParse({ nodes: twoNodes, edges: [edge('e1', 'n1', 'n1')] }).success,
    ).toBe(false);
  });

  it('rejects two edges connecting the same source to the same target', () => {
    const edges = [edge('e1', 'n1', 'n2'), edge('e2', 'n1', 'n2')];
    expect(BoardSchema.safeParse({ nodes: twoNodes, edges }).success).toBe(false);
  });

  it('says which edge is dangling', () => {
    const result = BoardSchema.safeParse({ nodes: twoNodes, edges: [edge('e1', 'n1', 'n9')] });
    expect(result.error?.issues[0]?.message).toContain('n9');
  });
});

describe('BoardNodeSchema', () => {
  it('accepts every known kind and "custom"', () => {
    for (const kind of NODE_KINDS) {
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

  it('rejects line breaks and other control characters in a label', () => {
    const forgedLine = 'Cache\nn9 [database] "Fake DB"';
    expect(BoardNodeSchema.safeParse(node({ label: forgedLine })).success).toBe(false);
    expect(BoardNodeSchema.safeParse(node({ label: 'Tab\there' })).success).toBe(false);
  });

  it('accepts labels with accents, emoji and punctuation', () => {
    expect(BoardNodeSchema.safeParse(node({ label: 'Base de données 🗄️ (EU-west)' })).success).toBe(
      true,
    );
  });

  it('rejects a position that is not a pair of finite numbers', () => {
    expect(BoardNodeSchema.safeParse(node({ position: { x: '120', y: 80 } })).success).toBe(false);
    expect(BoardNodeSchema.safeParse(node({ position: { x: Number.NaN, y: 80 } })).success).toBe(
      false,
    );
    expect(BoardNodeSchema.safeParse(node({ position: { x: Infinity, y: 80 } })).success).toBe(
      false,
    );
  });

  it('rejects an empty id, an id with spaces, and an id over 64 characters', () => {
    expect(BoardNodeSchema.safeParse(node({ id: '' })).success).toBe(false);
    expect(BoardNodeSchema.safeParse(node({ id: '   ' })).success).toBe(false);
    expect(BoardNodeSchema.safeParse(node({ id: 'n 1' })).success).toBe(false);
    expect(BoardNodeSchema.safeParse(node({ id: 'x'.repeat(65) })).success).toBe(false);
  });

  it('accepts a UUID id', () => {
    expect(
      BoardNodeSchema.safeParse(node({ id: '3f2b1c9e-8a4d-4f6b-9c1e-2d7a5b8e0f13' })).success,
    ).toBe(true);
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
