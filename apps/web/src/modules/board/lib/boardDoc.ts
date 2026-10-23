import {
  BoardEdgeSchema,
  BoardNodeSchema,
  ZoneSchema,
  type Board,
  type BoardEdge,
  type BoardNode,
  type Zone,
} from '@designroom/domain';
import * as Y from 'yjs';

/** What `readItems` needs from a domain schema (the web app gets zod only through the domain). */
type Schema<T> = {
  safeParse: (value: unknown) => { success: true; data: T } | { success: false };
};

// The board as a shared Yjs document (M2-02, ADR-010). Three maps — nodes, edges, zones — keyed by
// id; each item is a Y.Map of its fields, so two people changing different fields of one box both
// keep their change. The domain ops still decide every rule: the store computes the next board with
// them and `writeBoard` writes only the difference. `readBoard` returns a valid board even when two
// valid edits made the document invalid together (a box deleted while someone connected to it).

type Item = { id: string };
/** The document's three shared maps (undo tracks all three). */
export const BOARD_MAPS = ['nodes', 'edges', 'zones'] as const;
type Collection = (typeof BOARD_MAPS)[number];

/** Where an item sits in the board's lists: Y.Map has no order, every copy must agree on one. */
const ORDER = 'order';

const mapOf = (doc: Y.Doc, name: Collection) => doc.getMap<unknown>(name);

/** The items of one map that pass their schema, in order (then by id: ties from concurrent adds). */
const readItems = <T extends Item>(map: Y.Map<unknown>, schema: Schema<T>): T[] => {
  const read: { item: T; order: number }[] = [];
  map.forEach((value, id) => {
    if (!(value instanceof Y.Map)) return; // not something we wrote
    const { [ORDER]: order, ...fields } = value.toJSON() as Record<string, unknown>;
    const parsed = schema.safeParse({ ...fields, id }); // the key is the id, whatever a field says
    if (!parsed.success) return; // a buggy or hostile peer: skip it, keep the rest
    // NaN would make the sort differ between copies: anything not finite goes last.
    const finite = typeof order === 'number' && Number.isFinite(order);
    read.push({ item: parsed.data, order: finite ? order : Number.MAX_VALUE });
  });
  return read
    .sort((x, y) => x.order - y.order || (x.item.id < y.item.id ? -1 : 1))
    .map((r) => r.item);
};

/** Arrows two valid edits broke together: to a box deleted meanwhile, or a second one for a link. */
const repairEdges = (nodes: readonly BoardNode[], edges: readonly BoardEdge[]): BoardEdge[] => {
  const ids = new Set(nodes.map((n) => n.id));
  const links = new Set<string>();
  return edges.filter((edge) => {
    const link = `${edge.source}->${edge.target}`;
    if (!ids.has(edge.source) || !ids.has(edge.target) || edge.source === edge.target) return false;
    if (links.has(link)) return false; // the first in order wins, on every copy
    links.add(link);
    return true;
  });
};

/** The board the app sees: always valid, the same on every copy that has the same updates. */
export const readBoard = (doc: Y.Doc): Board => {
  const nodes = readItems<BoardNode>(mapOf(doc, 'nodes'), BoardNodeSchema);
  const edges = repairEdges(nodes, readItems<BoardEdge>(mapOf(doc, 'edges'), BoardEdgeSchema));
  const zones = readItems<Zone>(mapOf(doc, 'zones'), ZoneSchema);
  return zones.length > 0 ? { nodes, edges, zones } : { nodes, edges };
};

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

const fieldsOf = (item: Item) => Object.entries(item).filter(([key]) => key !== 'id');

/** The order after the last one in use: where items added now go. */
const nextOrder = (map: Y.Map<unknown>) => {
  let next = 0;
  map.forEach((value) => {
    const order: unknown = value instanceof Y.Map ? value.get(ORDER) : undefined;
    if (typeof order === 'number') next = Math.max(next, order + 1);
  });
  return next;
};

/** Writes a new item: attached first, so the fields set after join the same transaction. */
const createItem = (map: Y.Map<unknown>, item: Item, order: number) => {
  const created = new Y.Map<unknown>();
  map.set(item.id, created);
  created.set(ORDER, order);
  for (const [key, value] of fieldsOf(item)) created.set(key, value);
};

/** Writes only the fields that changed since `previous`; a cleared optional field is deleted. */
const updateItem = (existing: Y.Map<unknown>, previous: Record<string, unknown>, item: Item) => {
  for (const [key, value] of fieldsOf(item))
    if (!same(previous[key], value)) existing.set(key, value);
  for (const key of Object.keys(previous)) if (key !== 'id' && !(key in item)) existing.delete(key);
};

/** Writes the changes from `before` to `after` into one map: added, removed, changed fields. */
const writeItems = (map: Y.Map<unknown>, before: readonly Item[], after: readonly Item[]) => {
  const old = new Map(before.map((item) => [item.id, item]));
  const kept = new Set(after.map((item) => item.id));
  for (const item of before) if (!kept.has(item.id)) map.delete(item.id);

  let next = nextOrder(map);
  for (const item of after) {
    const existing = map.get(item.id);
    if (existing instanceof Y.Map) updateItem(existing, old.get(item.id) ?? {}, item);
    // Known before but gone from the doc: someone else deleted it. Don't bring it back.
    else if (!old.has(item.id)) createItem(map, item, next++);
  }
};

/**
 * Writes what changed from `before` (the board this copy last read) to `after` (the domain op's
 * result), in one transaction. `origin` marks it as this tab's, for undo (M2-03).
 */
export const writeBoard = (doc: Y.Doc, before: Board, after: Board, origin?: unknown): void => {
  doc.transact(() => {
    writeItems(mapOf(doc, 'nodes'), before.nodes, after.nodes);
    writeItems(mapOf(doc, 'edges'), before.edges, after.edges);
    writeItems(mapOf(doc, 'zones'), before.zones ?? [], after.zones ?? []);
  }, origin);
};
