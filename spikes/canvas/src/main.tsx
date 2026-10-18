import { StrictMode, useCallback, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ReactFlowVariant } from './ReactFlowVariant.tsx';
import { X6Variant } from './X6Variant.tsx';
import './spike.css';

type Engine = 'reactflow' | 'x6';

function App() {
  const [engine, setEngine] = useState<Engine>('reactflow');
  const [stats, setStats] = useState('');
  const onStats = useCallback((s: string) => setStats(s), []);
  return (
    <div className="spike-app">
      <header className="spike-header">
        <strong>Canvas spike — same board, two engines</strong>
        {(
          [
            ['reactflow', 'A · React Flow (+ libavoid)'],
            ['x6', 'B · AntV X6 (manhattan)'],
          ] as const
        ).map(([id, name]) => (
          <button key={id} type="button" aria-pressed={engine === id} onClick={() => setEngine(id)}>
            {name}
          </button>
        ))}
        <span className="spike-stats">{stats}</span>
      </header>
      {engine === 'reactflow' ? <ReactFlowVariant onStats={onStats} /> : <X6Variant onStats={onStats} />}
    </div>
  );
}

const root = document.getElementById('root');
if (root)
  createRoot(root).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
