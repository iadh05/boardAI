import { describe, expect, it } from 'vitest';
import { readSseData } from './sse.ts';

/** A body that arrives in the given pieces, like bytes off the network. */
const bodyOf = (...pieces: string[]) =>
  new ReadableStream<Uint8Array>({
    start(controller) {
      for (const piece of pieces) controller.enqueue(new TextEncoder().encode(piece));
      controller.close();
    },
  });

const collect = async (body: ReadableStream<Uint8Array>) => {
  const events: string[] = [];
  for await (const data of readSseData(body)) events.push(data);
  return events;
};

describe('readSseData', () => {
  it('yields the data of each event', async () => {
    expect(await collect(bodyOf('data: {"a":1}\n\ndata: {"b":2}\n\n'))).toEqual([
      '{"a":1}',
      '{"b":2}',
    ]);
  });

  it('reassembles an event split anywhere across network chunks', async () => {
    expect(await collect(bodyOf('da', 'ta: {"a"', ':1}\n', '\nda', 'ta: x\n\n'))).toEqual([
      '{"a":1}',
      'x',
    ]);
  });

  it('reassembles a character split across chunks', async () => {
    const bytes = new TextEncoder().encode('data: café\n\n');
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 10)); // cuts "é" (2 bytes) in half
        controller.enqueue(bytes.slice(10));
        controller.close();
      },
    });
    expect(await collect(body)).toEqual(['café']);
  });

  it('accepts CRLF line endings and data without a space', async () => {
    expect(await collect(bodyOf('data:x\r\n\r\ndata: y\r\n\r\n'))).toEqual(['x', 'y']);
  });

  it('joins the lines of a multi-line event and skips comments and other fields', async () => {
    expect(await collect(bodyOf(': keep-alive\n\nevent: msg\ndata: a\ndata: b\n\n'))).toEqual([
      'a\nb',
    ]);
  });

  it('yields a last event that has no blank line after it', async () => {
    expect(await collect(bodyOf('data: last'))).toEqual(['last']);
  });
});
