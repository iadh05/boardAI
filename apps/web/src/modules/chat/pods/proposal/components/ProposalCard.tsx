import { useId } from 'react';
import { Button } from '../../../../../core/ui/index.ts';

export type ProposalCardProps = {
  /** What Accept will do, in the user's words (labels, not ids). */
  summary: string;
  /** Why the last Accept failed — e.g. the board changed since the proposal. */
  error: string | null;
  onAccept: () => void;
  onReject: () => void;
};

/**
 * Molecule: the AI's pending change, shown as ghosts on the board. Nothing changes until the
 * user accepts; once a proposal no longer fits the board, only Reject is left.
 */
export function ProposalCard({ summary, error, onAccept, onReject }: ProposalCardProps) {
  const titleId = useId();
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col gap-2 rounded-lg border border-accent bg-surface p-3 text-sm"
    >
      <h3 id={titleId} className="font-semibold text-ink">
        Proposed change
      </h3>
      <p className="text-ink">{summary}</p>
      {error && (
        <p role="alert" className="text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button variant="primary" size="sm" onClick={onAccept} disabled={error !== null}>
          Accept
        </Button>
        <Button size="sm" onClick={onReject}>
          Reject
        </Button>
      </div>
    </section>
  );
}
