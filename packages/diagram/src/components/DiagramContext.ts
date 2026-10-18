import { createContext, useContext } from 'react';

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

export const DiagramContext = createContext<DiagramContextValue>({
  editingNodeId: null,
  maxLabelLength: 100,
  commitLabel: () => {},
  endEditing: () => {},
});

export const useDiagramContext = () => useContext(DiagramContext);
