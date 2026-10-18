import type { Edge, EdgeChange, NodeChange } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import { canvasChanges, commitMoves, mergeEdges, mergeNodes } from './changes.ts';
import type { BoxNode } from './toReactFlow.ts';

const node = (id: string, x = 0, extra: Partial<BoxNode> = {}): BoxNode => ({
  id,
  type: 'box',
  position: { x, y: 0 },
  data: { label: id, shape: 'rectangle', ghost: false },
  ...extra,
});
const edge = (id: string, extra: Partial<Edge> = {}): Edge => ({
  id,
  source: 'a',
  target: 'b',
  ...extra,
});

describe('mergeNodes', () => {
  it('takes data and positions from the props', () => {
    expect(mergeNodes([node('a', 50)], [node('a', 0)])[0]?.position).toEqual({ x: 50, y: 0 });
  });

  it('keeps what only the canvas knows: selection and measured size', () => {
    const current = [node('a', 0, { selected: true, measured: { width: 120, height: 40 } })];
    expect(mergeNodes([node('a', 10)], current)[0]).toMatchObject({
      selected: true,
      measured: { width: 120, height: 40 },
    });
  });

  it('keeps a node that is being dragged where the pointer has it', () => {
    const merged = mergeNodes([node('a', 0)], [node('a', 300, { dragging: true })]);
    expect(merged[0]).toMatchObject({ position: { x: 300, y: 0 }, dragging: true });
  });

  it('drops nodes that are gone and adds new ones', () => {
    expect(mergeNodes([node('b')], [node('a')]).map((n) => n.id)).toEqual(['b']);
  });
});

describe('mergeEdges', () => {
  it('takes edges from the props and keeps which one is selected', () => {
    expect(mergeEdges([edge('e1'), edge('e2')], [edge('e1', { selected: true })])).toEqual([
      edge('e1', { selected: true }),
      edge('e2'),
    ]);
  });

  it('drops edges that are gone', () => {
    expect(mergeEdges([], [edge('e1', { selected: true })])).toEqual([]);
  });
});

describe('canvasChanges', () => {
  it('keeps drag, select and measure; drops removals and additions (the app decides what exists)', () => {
    const changes: NodeChange<BoxNode>[] = [
      { type: 'position', id: 'a', position: { x: 1, y: 1 }, dragging: true },
      { type: 'select', id: 'a', selected: true },
      { type: 'dimensions', id: 'a', dimensions: { width: 1, height: 1 } },
      { type: 'remove', id: 'b' },
    ];
    expect(canvasChanges(changes)).toEqual(changes.slice(0, 3));
  });

  it('works on edge changes too', () => {
    const changes: EdgeChange[] = [
      { type: 'select', id: 'e1', selected: true },
      { type: 'remove', id: 'e2' },
    ];
    expect(canvasChanges(changes)).toEqual([{ type: 'select', id: 'e1', selected: true }]);
  });
});

describe('commitMoves', () => {
  const position = (dragging: boolean): NodeChange => ({
    type: 'position',
    id: 'a',
    position: { x: 10, y: 20 },
    dragging,
  });

  it('reports a position when the drag ends', () => {
    const onNodeMove = vi.fn();
    commitMoves([position(false)], onNodeMove);
    expect(onNodeMove).toHaveBeenCalledWith('a', { x: 10, y: 20 });
  });

  it('stays quiet while the drag is in progress (one update, not 60 a second)', () => {
    const onNodeMove = vi.fn();
    commitMoves([position(true)], onNodeMove);
    expect(onNodeMove).not.toHaveBeenCalled();
  });

  it('ignores selection and measurement changes', () => {
    const onNodeMove = vi.fn();
    commitMoves(
      [
        { type: 'select', id: 'a', selected: true },
        { type: 'dimensions', id: 'a', dimensions: { width: 1, height: 1 } },
      ],
      onNodeMove,
    );
    expect(onNodeMove).not.toHaveBeenCalled();
  });
});
