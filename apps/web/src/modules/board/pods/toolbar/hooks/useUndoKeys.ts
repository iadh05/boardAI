import { useEffect } from 'react';
import type { useBoardStore } from '../../../store/boardStore.ts';

/** Typing in a field: Ctrl+Z there belongs to the field, not to the board. */
const isTyping = (target: EventTarget | null) =>
  target instanceof HTMLElement &&
  (target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName));

/**
 * Ctrl+Z undoes your last board change; Ctrl+Shift+Z and Ctrl+Y redo (Cmd on a Mac). Only your
 * own changes: other people's stay (M2-03).
 */
export function useUndoKeys(store: typeof useBoardStore) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || isTyping(event.target)) return;
      const key = event.key.toLowerCase();
      const redo = key === 'y' || (key === 'z' && event.shiftKey);
      if (key !== 'z' && key !== 'y') return;
      event.preventDefault();
      if (redo) store.getState().redo();
      else store.getState().undo();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store]);
}
