import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import type { DiagramPosition } from '../types.ts';
import { Diagram } from './Diagram.tsx';
import { DiagramMarker } from './DiagramMarker.tsx';

// M2-06: what live cursors need from the diagram, without it knowing about people or rooms.

const renderDiagram = (onPointerMove: (p: DiagramPosition | null) => void) =>
  render(
    <div style={{ width: 800, height: 600 }}>
      <Diagram nodes={[]} edges={[]} ariaLabel="Diagram" onPointerMove={onPointerMove}>
        <DiagramMarker position={{ x: 120, y: 80 }}>
          <span>Guest 42</span>
        </DiagramMarker>
      </Diagram>
    </div>,
  );

describe('pointer and markers (M2-06)', () => {
  it('reports where the pointer is, in diagram coordinates, and null when it leaves', () => {
    const moves: (DiagramPosition | null)[] = [];
    renderDiagram((p) => moves.push(p));
    const diagram = screen.getByRole('application', { name: 'Diagram' });

    fireEvent.pointerMove(diagram, { clientX: 40, clientY: 30 });
    fireEvent.pointerLeave(diagram);

    expect(moves[0]).toEqual({ x: expect.any(Number) as number, y: expect.any(Number) as number });
    expect(moves.at(-1)).toBeNull();
  });

  it('draws a marker at its diagram position, out of the way of clicks', () => {
    renderDiagram(vi.fn());
    const marker = screen.getByText('Guest 42').parentElement;
    expect(marker?.style.transform).toContain('translate(120px, 80px)');
    expect(marker?.style.pointerEvents).toBe('none');
  });
});
