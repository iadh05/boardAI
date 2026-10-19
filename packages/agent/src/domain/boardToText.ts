import { zonesOf, type Board, type BoardEdge } from '@designroom/domain';
import type { Aliases } from './aliases.ts';

// The board as the model reads it (architecture §7): one line per node with its arrows, then one
// line per zone. Compact on purpose — every token here is paid on every round of every request.
//
//   n3 [api] "Orders API" -> n4, n5 (async, "order events")
//   zone z1 "VPC": n2, n3, n4
//
// Labels are user text: JSON-quoted, so a label can't close its quotes and pose as more board.

const quote = (text: string) => JSON.stringify(text);

const arrow = (edge: BoardEdge, aliases: Aliases) => {
  const details = [edge.mode === 'async' ? 'async' : '', edge.label ? quote(edge.label) : ''];
  const shown = details.filter(Boolean).join(', ');
  return `${aliases.nodeAlias(edge.target) ?? '?'}${shown ? ` (${shown})` : ''}`;
};

/** Map.groupBy (ES2024) for our ES2023 target: items by key, in order. */
const groupBy = <T>(items: readonly T[], keyOf: (item: T) => string) => {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const key = keyOf(item);
    const group = groups.get(key);
    if (group) group.push(item);
    else groups.set(key, [item]);
  }
  return groups;
};

export const boardToText = (board: Board, aliases: Aliases): string => {
  if (board.nodes.length === 0) return '(empty board)';
  const alias = (id: string) => aliases.nodeAlias(id) ?? '?';

  // One pass over edges and one zonesOf per node: linear in the board size.
  const outgoing = groupBy(board.edges, (e) => e.source);
  const members = groupBy(
    board.nodes.flatMap((n) => zonesOf(board, n.id).map((z) => ({ zone: z.id, node: n.id }))),
    (m) => m.zone,
  );

  const nodeLines = board.nodes.map((node) => {
    const out = (outgoing.get(node.id) ?? []).map((e) => arrow(e, aliases));
    const head = `${alias(node.id)} [${node.kind}] ${quote(node.label)}`;
    return out.length ? `${head} -> ${out.join(', ')}` : head;
  });

  const zoneLines = (board.zones ?? []).map((zone) => {
    const inside =
      members
        .get(zone.id)
        ?.map((m) => alias(m.node))
        .join(', ') ?? '(empty)';
    return `zone ${aliases.zoneAlias(zone.id) ?? '?'} ${quote(zone.label)}: ${inside}`;
  });

  return [...nodeLines, ...zoneLines].join('\n');
};
