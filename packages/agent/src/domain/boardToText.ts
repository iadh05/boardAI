import { zonesOf, type Board, type BoardEdge } from '@designroom/domain';
import type { Aliases } from './aliases.ts';

// The board as the model reads it (architecture §7): the boxes, one line per arrow, the zones.
// Compact on purpose — every token here is paid on every round of every request. One line per
// arrow costs ~16 % more than arrows on their box's line, but the model read 100 % of them instead
// of 57 % (M1-29, an 18-box board, 10 runs each).
//
//   Boxes:
//   n3 [api] "Orders API"
//
//   Arrows:
//   n3 -> n5 (async, label "order events")
//
//   Zones:
//   z1 "VPC": n2, n3, n4
//
// Labels are user text: JSON-quoted, so a label can't close its quotes and pose as more board, and
// with < and > escaped (<, >, as JSON allows), so it can't close the <board> tag the
// listing is sent in and pose as instructions after it (M1-24d).

export const quote = (text: string) =>
  JSON.stringify(text).replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');

/** `n3 -> n5 (async, label "order events")`: `label` spelled out, or the model reads it as a box. */
const arrow = (edge: BoardEdge, aliases: Aliases) => {
  const details = [
    edge.mode === 'async' ? 'async' : '',
    edge.label ? `label ${quote(edge.label)}` : '',
  ];
  const shown = details.filter(Boolean).join(', ');
  const end = (id: string) => aliases.nodeAlias(id) ?? '?';
  return `${end(edge.source)} -> ${end(edge.target)}${shown ? ` (${shown})` : ''}`;
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

/**
 * What the board already has, by kind (M1-29): read before the listing, so the model doesn't
 * claim a load balancer is missing when there is one, or add a second queue next to Kafka.
 * Sent inside the <board> block, quoted like the listing: labels are still data.
 */
export const inventoryText = (board: Board, aliases: Aliases): string => {
  if (board.nodes.length === 0) return '';
  const byKind = groupBy(board.nodes, (n) => n.kind);
  const lines = [...byKind].map(
    ([kind, nodes]) =>
      `- ${kind}: ${nodes.map((n) => `${aliases.nodeAlias(n.id) ?? '?'} ${quote(n.label)}`).join(', ')}`,
  );
  return ['Already on the board, by kind:', ...lines].join('\n');
};

export const boardToText = (board: Board, aliases: Aliases): string => {
  if (board.nodes.length === 0) return '(empty board)';
  const alias = (id: string) => aliases.nodeAlias(id) ?? '?';

  // One zonesOf per node: linear in the board size.
  const members = groupBy(
    board.nodes.flatMap((n) => zonesOf(board, n.id).map((z) => ({ zone: z.id, node: n.id }))),
    (m) => m.zone,
  );

  const boxes = board.nodes.map((n) => `${alias(n.id)} [${n.kind}] ${quote(n.label)}`);
  const arrows = board.edges.map((e) => arrow(e, aliases));
  const zones = (board.zones ?? []).map((zone) => {
    const inside =
      members
        .get(zone.id)
        ?.map((m) => alias(m.node))
        .join(', ') ?? '(empty)';
    return `${aliases.zoneAlias(zone.id) ?? '?'} ${quote(zone.label)}: ${inside}`;
  });

  return [
    ['Boxes:', ...boxes].join('\n'),
    arrows.length ? ['Arrows:', ...arrows].join('\n') : 'Arrows: none',
    ...(zones.length ? [['Zones:', ...zones].join('\n')] : []),
  ].join('\n\n');
};
