import { createRequiredContext } from './requiredContext.ts';

/**
 * What the node components need from <Diagram>'s props. React Flow renders node components
 * itself (props: the node only), so they read the rest from here.
 */
export type DiagramContextValue = {
  editingNodeId: string | null;
  maxLabelLength: number;
  commitLabel: (id: string, label: string) => void;
  endEditing: () => void;
};

export const [DiagramContext, useDiagramContext] =
  createRequiredContext<DiagramContextValue>('DiagramContext');
