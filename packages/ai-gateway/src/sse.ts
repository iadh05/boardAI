// Server-Sent Events, the format LLM APIs stream in: events separated by a blank line, each made
// of `field: value` lines. We only need `data`. Bytes arrive in arbitrary pieces — an event, a
// line, even a character can be cut in two — so text is buffered until an event is complete.

/** Yields the `data` of each event in the body, multi-line data joined with "\n". */
export async function* readSseData(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  let buffer = '';
  let data: string[] = [];

  const endOfEvent = () => {
    const event = data.length > 0 ? data.join('\n') : undefined;
    data = [];
    return event;
  };

  const readLine = (raw: string) => {
    const line = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
    if (line === '') return endOfEvent();
    if (line.startsWith('data:')) data.push(line.slice(line.startsWith('data: ') ? 6 : 5));
    // Comments (": keep-alive") and other fields (event, id, retry) are not used.
    return undefined;
  };

  // TextDecoderStream keeps a multi-byte character cut between two chunks until it's complete.
  for await (const text of body.pipeThrough(new TextDecoderStream())) {
    buffer += text;
    let newline = buffer.indexOf('\n');
    while (newline >= 0) {
      const event = readLine(buffer.slice(0, newline));
      buffer = buffer.slice(newline + 1);
      if (event !== undefined) yield event;
      newline = buffer.indexOf('\n');
    }
  }
  if (buffer !== '') readLine(buffer);
  const last = endOfEvent();
  if (last !== undefined) yield last;
}
