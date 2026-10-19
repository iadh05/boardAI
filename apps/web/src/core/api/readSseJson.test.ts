import { describe, expect, it } from 'vitest';
import { readSseJson, type SseItem } from './readSseJson.ts';

/** A body that arrives in these pieces, like bytes off the network. */
const bodyOf = (...pieces: (string | Uint8Array<ArrayBuffer>)[]) =>
  new ReadableStream<Uint8Array<ArrayBuffer>>({
    start(controller) {
      for (const piece of pieces)
        controller.enqueue(typeof piece === 'string' ? new TextEncoder().encode(piece) : piece);
      controller.close();
    },
  });

const collect = async (body: ReadableStream<Uint8Array<ArrayBuffer>>) => {
  const items: SseItem[] = [];
  for await (const item of readSseJson(body)) items.push(item);
  return items;
};

describe('readSseJson', () => {
  it('turns each event into its parsed JSON', async () => {
    expect(await collect(bodyOf('data: {"type":"text","delta":"Hi"}\n\n'))).toEqual([
      { ok: true, value: { type: 'text', delta: 'Hi' } },
    ]);
  });

  it('reassembles an event split across chunks', async () => {
    expect(await collect(bodyOf('data: {"ty', 'pe":"do', 'ne"}\n', '\n'))).toEqual([
      { ok: true, value: { type: 'done' } },
    ]);
  });

  it('emits both events when one chunk holds two', async () => {
    expect(await collect(bodyOf('data: {"n":1}\n\ndata: {"n":2}\n\n'))).toEqual([
      { ok: true, value: { n: 1 } },
      { ok: true, value: { n: 2 } },
    ]);
  });

  it('keeps a character whose bytes are split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: {"t":"café"}\n\n');
    const cut = bytes.indexOf(0xc3) + 1; // between the two bytes of "é"
    expect(await collect(bodyOf(bytes.slice(0, cut), bytes.slice(cut)))).toEqual([
      { ok: true, value: { t: 'café' } },
    ]);
  });

  it('reports invalid JSON as an error item and goes on with the next event', async () => {
    const items = await collect(bodyOf('data: {not json\n\ndata: {"n":2}\n\n'));

    expect(items[0]).toMatchObject({ ok: false, error: { code: 'INVALID_JSON' } });
    expect(items[1]).toEqual({ ok: true, value: { n: 2 } });
  });

  it('accepts CRLF, skips comments, and reads a last event with no blank line after it', async () => {
    expect(await collect(bodyOf(': ping\r\n\r\ndata: {"n":1}\r\n\r\ndata: {"n":2}'))).toEqual([
      { ok: true, value: { n: 1 } },
      { ok: true, value: { n: 2 } },
    ]);
  });
});
