import { fail, ok, type Result } from '@designroom/domain';

// Reads a server-sent-events body whose events carry JSON — what POST /api/chat streams.
// Not EventSource: it can only GET, and the chat must POST the board. So: fetch, then read the
// body stream ourselves. Generic on purpose (core/ knows no ChatEvent): the chat module checks
// each value with the domain schema.
//
// The bytes arrive in arbitrary pieces — an event, a line, even a character can be cut in two —
// so text is buffered until an event is complete (a blank line ends it).

/** One event: its parsed JSON, or why it couldn't be read. A bad event never ends the stream. */
export type SseItem = Result<unknown, 'INVALID_JSON'>;

const parse = (data: string): SseItem => {
  try {
    return ok(JSON.parse(data) as unknown);
  } catch {
    return fail('INVALID_JSON', `Not JSON: ${data.slice(0, 100)}`);
  }
};

export async function* readSseJson(
  body: ReadableStream<Uint8Array<ArrayBuffer>>, // what fetch gives as Response.body
): AsyncIterable<SseItem> {
  let buffer = '';
  let data: string[] = [];

  /** A line of the stream; returns the event's item when the line ends an event. */
  const readLine = (raw: string): SseItem | undefined => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line === '') {
      const event = data.length > 0 ? parse(data.join('\n')) : undefined;
      data = [];
      return event;
    }
    if (line.startsWith('data:')) data.push(line.slice(line.startsWith('data: ') ? 6 : 5));
    return undefined; // comments (": ping") and other fields are not used
  };

  // TextDecoderStream keeps a multi-byte character cut between two chunks until it's complete.
  for await (const text of body.pipeThrough(new TextDecoderStream())) {
    buffer += text;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const item = readLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (item) yield item;
      newline = buffer.indexOf('\n');
    }
  }
  // The stream may end without a final blank line.
  if (buffer !== '') readLine(buffer);
  const last = readLine('');
  if (last) yield last;
}
