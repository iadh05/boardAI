export type SpinnerProps = {
  /** What is loading, for screen readers. */
  label?: string;
};

/**
 * Atom: a loading indicator announced as a status. The label is real (visually hidden) text
 * inside the status region — live regions announce their content, not their aria-label.
 */
export function Spinner({ label = 'Loading' }: SpinnerProps) {
  return (
    <span role="status" className="inline-flex items-center">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-line border-t-accent"
      />
      <span className="sr-only">{label}</span>
    </span>
  );
}
