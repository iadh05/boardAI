import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './app/App.tsx';
import { startErrorTracking } from './core/observability/errorTracking.ts';
import './index.css';

// Before the first render, so a crash while starting is reported too. Off without a DSN.
startErrorTracking(import.meta.env.VITE_SENTRY_DSN);

const root = document.getElementById('root');
if (!root) throw new Error('index.html is missing <div id="root">');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
