import { AvoidLib } from 'libavoid-js';
// The package doesn't export its .wasm, so it's imported by path. Vite turns it into a hashed
// asset URL: downloaded once, then cached by the browser until libavoid-js changes.
import wasmUrl from '../../node_modules/libavoid-js/dist/libavoid.wasm?url';
import { createAvoidRouter } from './avoid.ts';
import type { DiagramRouter } from './types.ts';

let loading: Promise<DiagramRouter> | null = null;

/** The default router: libavoid, loaded on first use (not with the page), once per session. */
export const loadAvoidRouter = (): Promise<DiagramRouter> =>
  (loading ??= AvoidLib.load(wasmUrl).then(() => createAvoidRouter(AvoidLib.getInstance())));
