import { createRequiredContext } from './requiredContext.ts';

/** What zone components need from <Diagram>'s props. */
export type ZoneContextValue = {
  editingZoneId: string | null;
  minSize: { width: number; height: number };
  commitLabel: (id: string, label: string) => void;
  endEditing: () => void;
  resize: (id: string, size: { width: number; height: number }) => void;
};

export const [ZoneContext, useZoneContext] = createRequiredContext<ZoneContextValue>('ZoneContext');
