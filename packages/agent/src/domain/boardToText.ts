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

export const boardToText = (board: Board, aliases: Aliases): string => {
  if (board.nodes.length === 0) return '(empty board)';

  const nodeLines = board.nodes.map((node) => {
    const out = board.edges.filter((e) => e.source === node.id).map((e) => arrow(e, aliases));
    const head = `${aliases.nodeAlias(node.id) ?? '?'} [${node.kind}] ${quote(node.label)}`;
    return out.length ? `${head} -> ${out.join(', ')}` : head;
  });

  const zoneLines = (board.zones ?? []).map((zone) => {
    const inside = board.nodes
      .filter((n) => zonesOf(board, n.id).some((z) => z.id === zone.id))
      .map((n) => aliases.nodeAlias(n.id) ?? '?');
    const members = inside.length ? inside.join(', ') : '(empty)';
    return `zone ${aliases.zoneAlias(zone.id) ?? '?'} ${quote(zone.label)}: ${members}`;
  });

  return [...nodeLines, ...zoneLines].join('\n');
};
