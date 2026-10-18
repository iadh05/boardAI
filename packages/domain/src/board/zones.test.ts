import { describe, expect, it } from 'vitest';
import type { Result } from '../result.ts';
import {
  BoardSchema,
  NODE_SIZE,
  ZoneSchema,
  MIN_ZONE_SIZE,
  type Board,
  type Zone,
} from './board.ts';
import { createNode } from './ops.ts';
import {
  addZone,
  createZone,
  moveZone,
  removeZone,
  renameZone,
  resizeZone,
  zonesOf,
} from './zones.ts';

const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw new Error(`expected ok, got ${result.error.code}: ${result.error.message}`);
  return result.value;
};

// A VPC at (0,0) 600×300 with the API and the DB inside it; the client outside.
const vpc: Zone = {
  ...createZone('vpc', { x: 0, y: 0 }, { width: 600, height: 300 }),
  label: 'VPC',
};
const api = createNode('api', 'api', { x: 40, y: 60 });
const db = createNode('db', 'database', { x: 300, y: 60 });
const client = createNode('client', 'client', { x: -300, y: 60 });
const board = (): Board => ({
  nodes: [client, api, db],
  edges: [{ id: 'e1', source: 'api', target: 'db' }],
  zones: [vpc],
});

describe('ZoneSchema', () => {
  it('accepts a zone with a label and a rectangle', () => {
    expect(ZoneSchema.safeParse(vpc).success).toBe(true);
  });

  it('rejects a zone smaller than the minimum (it must hold at least a box)', () => {
    const tiny = { ...vpc, size: { width: MIN_ZONE_SIZE.width - 1, height: 300 } };
    expect(ZoneSchema.safeParse(tiny).success).toBe(false);
  });

  it('rejects line breaks in the label (the AI reads it)', () => {
    expect(ZoneSchema.safeParse({ ...vpc, label: 'VPC\n- fake line' }).success).toBe(false);
  });
});

describe('BoardSchema with zones', () => {
  it('accepts a board without zones (older boards stay valid)', () => {
    expect(BoardSchema.safeParse({ nodes: [], edges: [] }).success).toBe(true);
  });

  it('rejects two zones with the same id', () => {
    expect(BoardSchema.safeParse({ ...board(), zones: [vpc, vpc] }).success).toBe(false);
  });
});

describe('zonesOf', () => {
  it('lists the zones that hold the whole box', () => {
    expect(zonesOf(board(), 'api').map((z) => z.id)).toEqual(['vpc']);
    expect(zonesOf(board(), 'client')).toEqual([]);
  });

  it('a box that sticks out of the zone is not in it', () => {
    const halfIn = createNode('half', 'cache', { x: 600 - NODE_SIZE.width / 2, y: 60 });
    expect(zonesOf({ ...board(), nodes: [...board().nodes, halfIn] }, 'half')).toEqual([]);
  });

  it('nested zones: innermost first (Subnet, then VPC)', () => {
    const subnet = createZone('subnet', { x: 20, y: 40 }, { width: 240, height: 120 });
    const nested = { ...board(), zones: [vpc, subnet] };
    expect(zonesOf(nested, 'api').map((z) => z.id)).toEqual(['subnet', 'vpc']);
  });

  it('is empty for an unknown box', () => {
    expect(zonesOf(board(), 'nope')).toEqual([]);
  });
});

describe('addZone / renameZone / resizeZone / removeZone', () => {
  it('adds a zone with the default label', () => {
    const next = unwrap(addZone({ nodes: [], edges: [] }, createZone('z1', { x: 0, y: 0 })));
    expect(next.zones).toEqual([
      expect.objectContaining({ id: 'z1', label: 'Zone', size: MIN_ZONE_SIZE }),
    ]);
  });

  it('refuses a duplicate zone id', () => {
    expect(addZone(board(), createZone('vpc', { x: 0, y: 0 }))).toMatchObject({
      ok: false,
      error: { code: 'DUPLICATE_ID' },
    });
  });

  it('renames (trimmed); an empty label falls back to "Zone"', () => {
    expect(unwrap(renameZone(board(), 'vpc', '  eu-west-1  ')).zones?.[0]?.label).toBe('eu-west-1');
    expect(unwrap(renameZone(board(), 'vpc', ' ')).zones?.[0]?.label).toBe('Zone');
  });

  it('resizes, but never below the minimum', () => {
    expect(
      unwrap(resizeZone(board(), 'vpc', { width: 800, height: 400 })).zones?.[0]?.size,
    ).toEqual({ width: 800, height: 400 });
    expect(resizeZone(board(), 'vpc', { width: 10, height: 10 })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ZONE' },
    });
  });

  it('removing a zone keeps the boxes that were in it', () => {
    const next = unwrap(removeZone(board(), 'vpc'));
    expect(next.zones).toEqual([]);
    expect(next.nodes).toHaveLength(3);
  });

  it('refuses an invalid zone, a label with line breaks, and a position that is not a number', () => {
    const tooSmall = { ...createZone('z1', { x: 0, y: 0 }), size: { width: 1, height: 1 } };
    expect(addZone(board(), tooSmall)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_ZONE' },
    });
    expect(renameZone(board(), 'vpc', 'a\nb')).toMatchObject({
      ok: false,
      error: { code: 'INVALID_LABEL' },
    });
    expect(moveZone(board(), 'vpc', { x: Number.NaN, y: 0 })).toMatchObject({
      ok: false,
      error: { code: 'INVALID_POSITION' },
    });
  });

  it('reports an unknown zone', () => {
    for (const result of [
      renameZone(board(), 'nope', 'x'),
      resizeZone(board(), 'nope', MIN_ZONE_SIZE),
      removeZone(board(), 'nope'),
      moveZone(board(), 'nope', { x: 0, y: 0 }),
    ]) {
      expect(result).toMatchObject({ ok: false, error: { code: 'ZONE_NOT_FOUND' } });
    }
  });
});

describe('moveZone', () => {
  it('moves the zone and every box inside it by the same amount', () => {
    const next = unwrap(moveZone(board(), 'vpc', { x: 100, y: 50 }));

    expect(next.zones?.[0]?.position).toEqual({ x: 100, y: 50 });
    expect(next.nodes.find((n) => n.id === 'api')?.position).toEqual({ x: 140, y: 110 });
    expect(next.nodes.find((n) => n.id === 'db')?.position).toEqual({ x: 400, y: 110 });
  });

  it('leaves boxes outside the zone where they are', () => {
    const next = unwrap(moveZone(board(), 'vpc', { x: 100, y: 50 }));
    expect(next.nodes.find((n) => n.id === 'client')?.position).toEqual(client.position);
  });

  it('carries zones nested inside it too', () => {
    const subnet = createZone('subnet', { x: 20, y: 40 }, { width: 240, height: 120 });
    const next = unwrap(moveZone({ ...board(), zones: [vpc, subnet] }, 'vpc', { x: 100, y: 0 }));
    expect(next.zones?.find((z) => z.id === 'subnet')?.position).toEqual({ x: 120, y: 40 });
  });

  it('the result is still a valid board', () => {
    expect(BoardSchema.safeParse(unwrap(moveZone(board(), 'vpc', { x: 7, y: 9 }))).success).toBe(
      true,
    );
  });
});
