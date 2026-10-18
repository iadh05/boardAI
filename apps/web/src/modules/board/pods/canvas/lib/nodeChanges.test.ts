import type { NodeChange } from '@xyflow/react';
import { describe, expect, it, vi } from 'vitest';
import type { FlowNode } from '../../../lib/flowTypes.ts';
import { canvasChanges, commitNodeChanges, mergeFlowNodes } from './nodeChanges.ts';

const node = (id: string, x = 0, extra: Partial<FlowNode> = {}): FlowNode => ({
  id,
  type: 'system',
  position: { x, y: 0 },
  data: { kind: 'api', label: id },
  ...extra,
});

describe('mergeFlowNodes', () => {
  it('takes data and positions from the store', () => {
    const merged = mergeFlowNodes([node('a', 50)], [node('a', 0)]);
    expect(merged[0]?.position).toEqual({ x: 50, y: 0 });
  });

  it('keeps what only the canvas knows: selection and measured size', () => {
    const current = [node('a', 0, { selected: true, measured: { width: 120, height: 40 } })];

    const merged = mergeFlowNodes([node('a', 10)], current);

    expect(merged[0]).toMatchObject({ selected: true, measured: { width: 120, height: 40 } });
  });

  it('keeps a node that is being dragged where the pointer has it', () => {
    const current = [node('a', 300, { dragging: true })];

    const merged = mergeFlowNodes([node('a', 0)], current);

    expect(merged[0]).toMatchObject({ position: { x: 300, y: 0 }, dragging: true });
  });

  it('drops nodes the store no longer has and adds new ones', () => {
    const merged = mergeFlowNodes([node('b')], [node('a')]);
    expect(merged.map((n) => n.id)).toEqual(['b']);
  });
});

describe('commitNodeChanges', () => {
  const position = (dragging: boolean): NodeChange => ({
    type: 'position',
    id: 'a',
    position: { x: 10, y: 20 },
    dragging,
  });

  it('commits a position to the store when the drag ends', () => {
    const moveNode = vi.fn();

    commitNodeChanges([position(false)], { moveNode });

    expect(moveNode).toHaveBeenCalledWith('a', { x: 10, y: 20 });
  });

  it('does not touch the store while the drag is in progress', () => {
    const moveNode = vi.fn();

    commitNodeChanges([position(true)], { moveNode });

    expect(moveNode).not.toHaveBeenCalled();
  });

  it('ignores selection and measurement changes (canvas-only state)', () => {
    const moveNode = vi.fn();

    commitNodeChanges(
      [
        { type: 'select', id: 'a', selected: true },
        { type: 'dimensions', id: 'a', dimensions: { width: 1, height: 1 } },
      ],
      { moveNode },
    );

    expect(moveNode).not.toHaveBeenCalled();
  });
});

describe('canvasChanges', () => {
  it('keeps the changes the canvas may apply itself (drag, select, measure)', () => {
    const changes: NodeChange<FlowNode>[] = [
      { type: 'position', id: 'a', position: { x: 1, y: 1 }, dragging: true },
      { type: 'select', id: 'a', selected: true },
      { type: 'dimensions', id: 'a', dimensions: { width: 1, height: 1 } },
    ];
    expect(canvasChanges(changes)).toEqual(changes);
  });

  it('drops removals and additions: only the store decides what exists', () => {
    const changes: NodeChange<FlowNode>[] = [
      { type: 'remove', id: 'a' },
      { type: 'select', id: 'b', selected: true },
    ];
    expect(canvasChanges(changes)).toEqual([{ type: 'select', id: 'b', selected: true }]);
  });
});
