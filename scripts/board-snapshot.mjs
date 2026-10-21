// Board snapshots (2026-10-21): rooms live in the server's memory until M3, so a restart loses
// them. This saves a room's board to JSON (the domain's shape, ids kept) and draws it back.
//
//   node scripts/board-snapshot.mjs save <room> <file.json>
//   node scripts/board-snapshot.mjs load <file.json> [room]    (a new room when none is given)
//
// Talks to the running server like a browser tab does (ws://localhost:3000/ws/rooms).
// Plain .mjs: yjs and y-websocket are the server's dependencies, loaded from there.

import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';

const require = createRequire(new URL('../apps/server/package.json', import.meta.url));
const Y = require('yjs');
const WebSocket = require('ws');
const { WebsocketProvider } = require('y-websocket');

const out = (line) => process.stdout.write(`${line}\n`);
const SERVER = process.env.ROOMS_URL ?? 'ws://localhost:3000/ws/rooms';
const MAPS = ['nodes', 'edges', 'zones'];

const open = async (room) => {
  const doc = new Y.Doc();
  const provider = new WebsocketProvider(SERVER, room, doc, {
    WebSocketPolyfill: WebSocket,
    disableBc: true,
  });
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no answer from ${SERVER}`)), 10_000);
    provider.on('sync', (synced) => synced && (clearTimeout(timer), resolve()));
  });
  return { doc, provider };
};

const newRoomId = () =>
  Array.from(
    { length: 12 },
    () => 'abcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 36)],
  ).join('');

const [command, a, b] = process.argv.slice(2);

if (command === 'save' && a && b) {
  const { doc, provider } = await open(a);
  const items = (name) =>
    [...doc.getMap(name).entries()]
      .map(([id, item]) => ({ id, ...item.toJSON() }))
      .sort((x, y) => (x.order ?? 0) - (y.order ?? 0))
      .map(({ order: _order, ...rest }) => rest);
  const board = Object.fromEntries(MAPS.map((name) => [name, items(name)]));
  writeFileSync(b, `${JSON.stringify(board, null, 2)}\n`);
  out(
    `${a}: ${board.nodes.length} boxes, ${board.edges.length} arrows, ${board.zones.length} zones → ${b}`,
  );
  provider.destroy();
} else if (command === 'load' && a) {
  const board = JSON.parse(readFileSync(a, 'utf8'));
  const room = b ?? newRoomId();
  const { doc, provider } = await open(room);
  doc.transact(() => {
    for (const name of MAPS)
      (board[name] ?? []).forEach(({ id, ...fields }, order) => {
        const item = new Y.Map();
        doc.getMap(name).set(id ?? randomUUID(), item);
        item.set('order', order);
        for (const [key, value] of Object.entries(fields)) item.set(key, value);
      });
  });
  await new Promise((resolve) => setTimeout(resolve, 1500)); // let the update reach the server
  out(`drew ${a} into room ${room}: http://localhost:8080/room/${room}`);
  provider.destroy();
} else {
  out('usage: board-snapshot.mjs save <room> <file.json> | load <file.json> [room]');
  process.exitCode = 1;
}
process.exit();
