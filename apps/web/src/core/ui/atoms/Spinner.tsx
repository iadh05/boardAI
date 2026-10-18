export type SpinnerProps = {
  /** What is loading, for screen readers. */
  label?: string;
};

/** Atom: a loading indicator announced as a status. */
export function Spinner({ label = 'Loading' }: SpinnerProps) {
  return (
    <span role="status" aria-label={label} className="inline-flex">
      <span
        aria-hidden="true"
        className="size-4 animate-spin rounded-full border-2 border-line border-t-accent"
      />
    </span>
  );
}
