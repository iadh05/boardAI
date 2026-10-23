import { Redo2, Undo2 } from 'lucide-react';
import { ToolButton } from '../../../../../core/ui/index.ts';
import type { useBoardStore } from '../../../store/boardStore.ts';

export type HistoryButtonsProps = {
  store: typeof useBoardStore;
};

/** Undo and Redo: the "History" toolbar, greyed out when its stack is empty. */
export function HistoryButtons({ store }: HistoryButtonsProps) {
  const undo = store((s) => s.undo);
  const redo = store((s) => s.redo);
  const canUndo = store((s) => s.canUndo);
  const canRedo = store((s) => s.canRedo);
  return (
    <div role="toolbar" aria-label="History" className="contents">
      <ToolButton
        icon={Undo2}
        caption="Undo"
        onClick={undo}
        disabled={!canUndo}
        className="disabled:opacity-40"
      />
      <ToolButton
        icon={Redo2}
        caption="Redo"
        onClick={redo}
        disabled={!canRedo}
        className="disabled:opacity-40"
      />
    </div>
  );
}
