import { afterEach, expect, it } from 'vitest';
import { showProposal, useBoardStore } from './index.ts';

afterEach(() => {
  useBoardStore.getState().rejectProposal();
});

it('showProposal puts the proposal on the app board store', () => {
  showProposal({
    id: 'p1',
    summary: 'Add a cache',
    ops: [{ op: 'addNode', nodeId: 'cache', kind: 'cache', label: 'Cache' }],
  });

  expect(useBoardStore.getState().proposal?.id).toBe('p1');
});
