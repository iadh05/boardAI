import { fail, ok } from '../result.ts';
import {
  MIN_ZONE_SIZE,
  NODE_SIZE,
  PositionSchema,
  ZoneSchema,
  ZoneSizeSchema,
  type Board,
  type Position,
  type Zone,
  type ZoneSize,
} from './board.ts';
import type { BoardResult } from './ops.ts';

// Zones (ADR-005): shapes that group boxes. Which boxes a zone holds comes from position, so the
// ops below never store a parent — they compute who is inside when it matters (moving a zone).

/** The label a new zone gets, and the fallback when a label is cleared. */
export const DEFAULT_ZONE_LABEL = 'Zone';

type Rect = { x: number; y: number; width: number; height: number };

const rectOfZone = (z: Zone): Rect => ({ ...z.position, ...z.size });
const rectOfNode = (p: Position): Rect => ({ ...p, ...NODE_SIZE });
const contains = (outer: Rect, inner: Rect): boolean =>
  inner.x >= outer.x &&
  inner.y >= outer.y &&
  inner.x + inner.width <= outer.x + outer.width &&
  inner.y + inner.height <= outer.y + outer.height;
const area = (r: Rect) => r.width * r.height;

const zonesIn = (board: Board): Zone[] => board.zones ?? [];
const findZone = (board: Board, id: string) => zonesIn(board).find((z) => z.id === id);
const zoneNotFound = (id: string) => fail('ZONE_NOT_FOUND', `No zone with id "${id}"`);

/** A new zone at `position`, minimum size by default. */
export const createZone = (
  id: string,
  position: Position,
  size: ZoneSize = MIN_ZONE_SIZE,
): Zone => ({ id, label: DEFAULT_ZONE_LABEL, position, size: { ...size } });

/** The zones holding the whole box, innermost (smallest) first. */
export const zonesOf = (board: Board, nodeId: string): Zone[] => {
  const node = board.nodes.find((n) => n.id === nodeId);
  if (!node) return [];
  const box = rectOfNode(node.position);
  return zonesIn(board)
    .filter((z) => contains(rectOfZone(z), box))
    .sort((a, b) => area(rectOfZone(a)) - area(rectOfZone(b)));
};

const replaceZone = (board: Board, zone: Zone): Board => ({
  ...board,
  zones: zonesIn(board).map((z) => (z.id === zone.id ? zone : z)),
});

export const addZone = (board: Board, zone: Zone): BoardResult => {
  const parsed = ZoneSchema.safeParse(zone);
  if (!parsed.success) {
    return fail('INVALID_ZONE', parsed.error.issues[0]?.message ?? 'Invalid zone');
  }
  if (findZone(board, zone.id)) {
    return fail('DUPLICATE_ID', `A zone with id "${zone.id}" already exists`);
  }
  return ok({ ...board, zones: [...zonesIn(board), parsed.data] });
};

/** Trims the label; an empty label falls back to "Zone". */
export const renameZone = (board: Board, id: string, label: string): BoardResult => {
  const zone = findZone(board, id);
  if (!zone) return zoneNotFound(id);
  const next = label.trim() || DEFAULT_ZONE_LABEL;
  const parsed = ZoneSchema.shape.label.safeParse(next);
  if (!parsed.success) {
    return fail('INVALID_LABEL', parsed.error.issues[0]?.message ?? 'Invalid label');
  }
  return ok(replaceZone(board, { ...zone, label: parsed.data }));
};

export const resizeZone = (board: Board, id: string, size: ZoneSize): BoardResult => {
  const zone = findZone(board, id);
  if (!zone) return zoneNotFound(id);
  const parsed = ZoneSizeSchema.safeParse(size);
  if (!parsed.success) {
    return fail(
      'INVALID_ZONE',
      `A zone is at least ${MIN_ZONE_SIZE.width}×${MIN_ZONE_SIZE.height}`,
    );
  }
  return ok(replaceZone(board, { ...zone, size: parsed.data }));
};

/**
 * Moves a zone and everything inside it — boxes and nested zones — by the same amount, in one
 * update (one undo step in M2).
 */
export const moveZone = (board: Board, id: string, position: Position): BoardResult => {
  const zone = findZone(board, id);
  if (!zone) return zoneNotFound(id);
  if (!PositionSchema.safeParse(position).success) {
    return fail('INVALID_POSITION', 'Positions must be finite numbers');
  }
  const outer = rectOfZone(zone);
  const dx = position.x - zone.position.x;
  const dy = position.y - zone.position.y;
  const shift = (p: Position): Position => ({ x: p.x + dx, y: p.y + dy });

  return ok({
    ...board,
    nodes: board.nodes.map((n) =>
      contains(outer, rectOfNode(n.position)) ? { ...n, position: shift(n.position) } : n,
    ),
    zones: zonesIn(board).map((z) =>
      z.id === id || contains(outer, rectOfZone(z)) ? { ...z, position: shift(z.position) } : z,
    ),
  });
};

/** Removes the zone only; the boxes that were in it stay where they are. */
export const removeZone = (board: Board, id: string): BoardResult => {
  if (!findZone(board, id)) return zoneNotFound(id);
  return ok({ ...board, zones: zonesIn(board).filter((z) => z.id !== id) });
};
