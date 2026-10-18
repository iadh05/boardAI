import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { DiagramEdge, DiagramNode } from '../types.ts';
import { Diagram, type DiagramProps } from './Diagram.tsx';
import { DiagramPanel } from './DiagramPanel.tsx';
import { useDiagramViewport } from './useDiagramViewport.ts';

const api: DiagramNode = { id: 'api', label: 'Orders API', position: { x: 0, y: 0 } };
const db: DiagramNode = { id: 'db', label: 'Postgres', position: { x: 300, y: 0 } };
const link: DiagramEdge = { id: 'e1', source: 'api', target: 'db' };
// Module constants: a default array in the parameters would be new on every render.
const NODES = [api, db];
const EDGES = [link];

type HarnessProps = Partial<DiagramProps> & {
  initialNodes?: DiagramNode[];
  initialEdges?: DiagramEdge[];
};

/** Holds the diagram's state the way an app store would, and spies on every callback. */
function Harness({ initialNodes = NODES, initialEdges = EDGES, ...spies }: HarnessProps) {
  const [nodes, setNodes] = useState<DiagramNode[]>([]);
  const [edges, setEdges] = useState<DiagramEdge[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  // Load after mount: in jsdom React Flow never measures nodes present on the first render.
  // That second render is the point here, so the usual "no setState in an effect" doesn't apply.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- deliberate post-mount load (see above)
    setNodes(initialNodes);
    setEdges(initialEdges);
  }, [initialNodes, initialEdges]);

  return (
    <div style={{ width: 800, height: 600 }}>
      <Diagram
        nodes={nodes}
        edges={edges}
        editingNodeId={editing}
        {...spies}
        onEditStart={(id) => {
          spies.onEditStart?.(id);
          setEditing(id);
        }}
        onLabelCommit={(id, label) => {
          spies.onLabelCommit?.(id, label);
          setNodes((ns) => ns.map((n) => (n.id === id ? { ...n, label } : n)));
        }}
        onEditEnd={() => {
          spies.onEditEnd?.();
          setEditing(null);
        }}
      >
        {spies.children}
      </Diagram>
    </div>
  );
}

const node = (name: string) => screen.getByRole('group', { name });
const labelInput = () => screen.getByRole<HTMLInputElement>('textbox', { name: 'Node label' });

describe('Diagram — showing', () => {
  it('shows each node as a named group with its label', async () => {
    render(<Harness />);
    expect(await screen.findByRole('group', { name: 'Orders API' })).toHaveTextContent(
      'Orders API',
    );
    expect(node('Postgres')).toBeInTheDocument();
  });

  it('is named as a whole', () => {
    render(<Harness ariaLabel="Board" />);
    expect(screen.getByRole('application', { name: 'Board' })).toBeInTheDocument();
  });

  it('marks ghost nodes as proposed', async () => {
    render(<Harness initialNodes={[api, { ...db, ghost: true }]} />);
    expect(await screen.findByRole('group', { name: 'Proposed: Postgres' })).toHaveTextContent(
      'proposed',
    );
  });

  it('draws the icon it is given', async () => {
    render(<Harness initialNodes={[{ ...api, icon: <svg aria-label="API icon" role="img" /> }]} />);
    expect(await screen.findByRole('img', { name: 'API icon' })).toBeInTheDocument();
  });

  it('names edges after the nodes they link', async () => {
    render(<Harness />);
    expect(await screen.findByLabelText('From Orders API to Postgres')).toBeInTheDocument();
  });
});

describe('Diagram — label editing', () => {
  it('double-click asks to edit; the input opens focused with the text selected', async () => {
    const onEditStart = vi.fn();
    render(<Harness onEditStart={onEditStart} />);

    fireEvent.doubleClick(await screen.findByRole('group', { name: 'Postgres' }));

    expect(onEditStart).toHaveBeenCalledWith('db');
    expect(labelInput()).toHaveFocus();
    expect([labelInput().selectionStart, labelInput().selectionEnd]).toEqual([0, 8]);
  });

  it('Enter on a focused node asks to edit it too', async () => {
    const onEditStart = vi.fn();
    render(<Harness onEditStart={onEditStart} />);

    (await screen.findByRole('group', { name: 'Postgres' })).focus();
    await userEvent.keyboard('{Enter}');

    expect(onEditStart).toHaveBeenCalledWith('db');
  });

  it('ghost nodes cannot be edited', async () => {
    const onEditStart = vi.fn();
    render(<Harness initialNodes={[{ ...db, ghost: true }]} onEditStart={onEditStart} />);

    fireEvent.doubleClick(await screen.findByRole('group', { name: 'Proposed: Postgres' }));

    expect(onEditStart).not.toHaveBeenCalled();
  });

  it('Enter commits the label, ends editing, and gives focus back to the node', async () => {
    const onLabelCommit = vi.fn();
    const onEditEnd = vi.fn();
    render(<Harness onLabelCommit={onLabelCommit} onEditEnd={onEditEnd} />);
    fireEvent.doubleClick(await screen.findByRole('group', { name: 'Postgres' }));

    await userEvent.keyboard('Users DB{Enter}');

    expect(onLabelCommit).toHaveBeenCalledWith('db', 'Users DB');
    expect(onEditEnd).toHaveBeenCalledOnce();
    expect(node('Users DB')).toHaveFocus();
  });

  it('leaving the input commits too', async () => {
    const onLabelCommit = vi.fn();
    render(<Harness onLabelCommit={onLabelCommit} />);
    fireEvent.doubleClick(await screen.findByRole('group', { name: 'Postgres' }));

    await userEvent.keyboard('Users DB');
    fireEvent.blur(labelInput());

    expect(onLabelCommit).toHaveBeenCalledWith('db', 'Users DB');
  });

  it('Escape cancels: nothing committed', async () => {
    const onLabelCommit = vi.fn();
    const onEditEnd = vi.fn();
    render(<Harness onLabelCommit={onLabelCommit} onEditEnd={onEditEnd} />);
    fireEvent.doubleClick(await screen.findByRole('group', { name: 'Postgres' }));

    await userEvent.keyboard('Nope{Escape}');

    expect(onLabelCommit).not.toHaveBeenCalled();
    expect(onEditEnd).toHaveBeenCalledOnce();
    expect(node('Postgres')).toHaveFocus();
  });

  it('pasted tabs and line breaks become spaces (labels are one line)', async () => {
    const onLabelCommit = vi.fn();
    render(<Harness onLabelCommit={onLabelCommit} />);
    fireEvent.doubleClick(await screen.findByRole('group', { name: 'Postgres' }));

    await userEvent.paste('Users\tDB');
    await userEvent.keyboard('{Enter}');

    expect(onLabelCommit).toHaveBeenCalledWith('db', 'Users DB');
  });

  it('Backspace edits the text and never deletes the node', async () => {
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} />);
    fireEvent.doubleClick(await screen.findByRole('group', { name: 'Postgres' }));

    await userEvent.keyboard('{End}{Backspace}{Delete}');

    expect(onDelete).not.toHaveBeenCalled();
  });

  it('limits the label length', async () => {
    render(<Harness maxLabelLength={40} />);
    fireEvent.doubleClick(await screen.findByRole('group', { name: 'Postgres' }));
    expect(labelInput()).toHaveAttribute('maxLength', '40');
  });
});

describe('Diagram — deleting', () => {
  // A plain click selects without a mousedown: jsdom gives mousedown a null `view`, which
  // React Flow's drag library (d3-drag) can't handle. Real browsers are fine.
  it('Backspace on a selected node reports it and its edges', async () => {
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} />);

    fireEvent.click(await screen.findByText('Orders API'));
    await userEvent.keyboard('{Backspace}');

    expect(onDelete).toHaveBeenCalledWith(['api'], ['e1']);
  });

  it('the Delete key works too', async () => {
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} />);

    fireEvent.click(await screen.findByText('Postgres'));
    await userEvent.keyboard('{Delete}');

    expect(onDelete).toHaveBeenCalledWith(['db'], ['e1']);
  });

  it('a selected edge is reported alone', async () => {
    const onDelete = vi.fn();
    render(<Harness onDelete={onDelete} />);

    fireEvent.click(await screen.findByLabelText('From Orders API to Postgres'));
    await userEvent.keyboard('{Backspace}');

    expect(onDelete).toHaveBeenCalledWith([], ['e1']);
  });

  it('ghost nodes cannot be deleted', async () => {
    const onDelete = vi.fn();
    render(
      <Harness initialNodes={[{ ...db, ghost: true }]} initialEdges={[]} onDelete={onDelete} />,
    );

    fireEvent.click(await screen.findByText('Postgres'));
    await userEvent.keyboard('{Backspace}');

    expect(onDelete).not.toHaveBeenCalled();
  });
});

describe('Diagram — panels', () => {
  function CenterButton({ onCenter }: { onCenter: (p: { x: number; y: number }) => void }) {
    const viewport = useDiagramViewport();
    return (
      <button type="button" onClick={() => onCenter(viewport.center())}>
        Where am I
      </button>
    );
  }

  it('renders panels over the diagram, and they can read the view centre', async () => {
    const onCenter = vi.fn<(point: { x: number; y: number }) => void>();
    render(
      <Harness>
        <DiagramPanel position="top-left">
          <CenterButton onCenter={onCenter} />
        </DiagramPanel>
      </Harness>,
    );

    await userEvent.click(screen.getByRole('button', { name: 'Where am I' }));

    const point = onCenter.mock.calls[0]?.[0];
    expect(Number.isFinite(point?.x) && Number.isFinite(point?.y)).toBe(true);
  });
});

it('has zoom controls', () => {
  render(<Harness />);
  expect(screen.getByRole('button', { name: /zoom in/i })).toBeInTheDocument();
});
