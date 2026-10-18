import { AvoidLib } from 'libavoid-js';
// The package doesn't export its .wasm, so it's imported by path. Vite turns it into a hashed
// asset URL: downloaded once, then cached by the browser until libavoid-js changes.
import wasmUrl from '../../node_modules/libavoid-js/dist/libavoid.wasm?url';
import { createAvoidRouter } from './avoid.ts';
import type { DiagramRouter } from './types.ts';

let loading: Promise<DiagramRouter> | null = null;

/** jsdom (unit tests) can't fetch and compile the wasm: there, the router never loads. */
const inJsdom = () => /jsdom/i.test(globalThis.navigator?.userAgent ?? '');

/**
 * The default router: libavoid, loaded on first use (not with the page), once per session.
 * Never settles in jsdom, so components there keep their simple arrows without any mocking.
 */
export const loadAvoidRouter = (): Promise<DiagramRouter> =>
  (loading ??= inJsdom()
    ? new Promise<DiagramRouter>(() => {})
    : AvoidLib.load(wasmUrl).then(() => createAvoidRouter(AvoidLib.getInstance())));
