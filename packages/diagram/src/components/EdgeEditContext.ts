import { createContext, useContext } from 'react';

/** What the edge components need from <Diagram>'s props to edit an arrow in place. */
export type EdgeEditContextValue = {
  editingEdgeId: string | null;
  maxLabelLength: number;
  dashedLabel: string;
  commitLabel: (id: string, label: string) => void;
  setDashed: (id: string, dashed: boolean) => void;
  endEditing: () => void;
};

export const EdgeEditContext = createContext<EdgeEditContextValue>({
  editingEdgeId: null,
  maxLabelLength: 40,
  dashedLabel: 'Dashed',
  commitLabel: () => {},
  setDashed: () => {},
  endEditing: () => {},
});

export const useEdgeEditContext = () => useContext(EdgeEditContext);
