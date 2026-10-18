import type { Edge, EdgeChange } from '@xyflow/react';
import { describe, expect, it } from 'vitest';
import { mergeFlowEdges } from './edgeChanges.ts';
import { canvasChanges } from './nodeChanges.ts';

const edge = (id: string, extra: Partial<Edge> = {}): Edge => ({
  id,
  source: 'a',
  target: 'b',
  ...extra,
});

describe('mergeFlowEdges', () => {
  it('takes edges from the store and keeps which one is selected', () => {
    const merged = mergeFlowEdges([edge('e1'), edge('e2')], [edge('e1', { selected: true })]);
    expect(merged).toEqual([edge('e1', { selected: true }), edge('e2')]);
  });

  it('drops edges the store no longer has', () => {
    expect(mergeFlowEdges([], [edge('e1', { selected: true })])).toEqual([]);
  });
});

describe('canvasChanges on edges', () => {
  it('keeps selection, drops removals: only the store decides what exists', () => {
    const changes: EdgeChange[] = [
      { type: 'select', id: 'e1', selected: true },
      { type: 'remove', id: 'e2' },
    ];
    expect(canvasChanges(changes)).toEqual([{ type: 'select', id: 'e1', selected: true }]);
  });
});
