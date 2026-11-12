/**
 * Parse a Server-Sent Events byte stream and yield the `data` payload of each event.
 *
 * Network chunks do not align with event boundaries, so we buffer text and only emit once a
 * blank line ends an event. Comment lines (starting with ":") and other fields are ignored.
 */
export async function* parseSse(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dataOf = (rawEvent: string): string | null => {
    const lines = rawEvent
      .split('\n')
      .filter((line) => line.startsWith('data:'))
      .map((line) => line.slice(5).replace(/^ /, ''));
    return lines.length > 0 ? lines.join('\n') : null;
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      // Normalise CRLF on the whole buffer so a "\r" and "\n" split across chunks still join.
      buffer = (buffer + decoder.decode(value, { stream: true })).replace(/\r\n/g, '\n');
      const events = buffer.split('\n\n');
      buffer = events.pop() ?? '';
      for (const rawEvent of events) {
        const data = dataOf(rawEvent);
        if (data !== null) yield data;
      }
    }
    buffer = (buffer + decoder.decode()).replace(/\r\n/g, '\n');
    // A final event may arrive without the terminating blank line.
    const last = buffer.trim() === '' ? null : dataOf(buffer);
    if (last !== null) yield last;
  } finally {
    // Runs on normal completion, on error, and when the consumer stops iterating early.
    await reader.cancel().catch(() => undefined);
  }
}
