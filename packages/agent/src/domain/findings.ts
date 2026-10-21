import { z } from 'zod';

// The contract between the specialists and the Architect (AV2-05, D7), and the merge in code
// (D8). A specialist returns data, never prose for another agent: the Architect merges findings,
// it doesn't read essays. Box ids are the board's real ids (the specialist's aliases are
// translated back before a finding leaves it).

export const SEVERITIES = ['info', 'warn', 'critical'] as const;
export type Severity = (typeof SEVERITIES)[number];

export const FindingSchema = z.object({
  /** Who found it: "data", "security", or an ad-hoc expert's name (D17). */
  specialist: z.string().min(1).max(40),
  /** What kind of problem, e.g. "single-database": the merge dedupes and finds conflicts on it. */
  kind: z.string().min(1).max(40),
  boxIds: z.array(z.string().min(1)).min(1).max(10),
  severity: z.enum(SEVERITIES),
  problem: z.string().min(1).max(400),
  fix: z.string().min(1).max(400).optional(),
  /** 0–1, how sure the specialist is: a rule is 1, a model's guess less. */
  confidence: z.number().min(0).max(1),
});
export type Finding = z.infer<typeof FindingSchema>;

/** A finding after the merge: who agreed on it. */
export type MergedFinding = Finding & { from: string[] };

/** Two specialists that want opposite things on the same boxes: both kept, the user decides. */
export type Conflict = { kinds: [string, string]; boxIds: string[]; tradeoff: string };

/** Pairs of kinds known to pull in opposite directions (D8). Grows with the specialists. */
const CONFLICTS: { kinds: [string, string]; tradeoff: string }[] = [
  {
    kinds: ['drop-replica', 'keep-replica'],
    tradeoff: 'A replica costs money every month; without it, one failure takes the data down.',
  },
  {
    kinds: ['remove-cache', 'add-cache'],
    tradeoff: 'A cache adds cost and stale reads; without it, every read hits the database.',
  },
];

const RANK: Record<Severity, number> = { info: 0, warn: 1, critical: 2 };

const keyOf = (f: Finding) => `${f.kind}|${[...f.boxIds].sort().join(',')}`;

const stronger = (a: Finding, b: Finding) =>
  RANK[b.severity] > RANK[a.severity] ||
  (RANK[b.severity] === RANK[a.severity] && b.confidence > a.confidence);

export const mergeFindings = (
  findings: readonly Finding[],
): { findings: MergedFinding[]; conflicts: Conflict[] } => {
  const merged = new Map<string, MergedFinding>();
  for (const f of findings) {
    const key = keyOf(f);
    const seen = merged.get(key);
    if (!seen) merged.set(key, { ...f, from: [f.specialist] });
    else {
      const from = seen.from.includes(f.specialist) ? seen.from : [...seen.from, f.specialist];
      merged.set(key, stronger(seen, f) ? { ...f, from } : { ...seen, from });
    }
  }
  const sorted = [...merged.values()].sort(
    (a, b) => RANK[b.severity] - RANK[a.severity] || b.confidence - a.confidence,
  );

  const conflicts = CONFLICTS.flatMap(({ kinds, tradeoff }) => {
    const [left, right] = kinds;
    return sorted
      .filter((f) => f.kind === left)
      .flatMap((a) =>
        sorted
          .filter((b) => b.kind === right)
          .map((b) => a.boxIds.filter((id) => b.boxIds.includes(id)))
          .filter((shared) => shared.length > 0)
          .map((boxIds) => ({ kinds, boxIds, tradeoff })),
      );
  });
  return { findings: sorted, conflicts };
};
