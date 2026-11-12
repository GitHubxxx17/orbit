import { describe, expect, it } from 'vitest';
import { parseSse } from '../../src/llm/sse.js';
import { collect, streamOf } from './helpers.js';

const parse = (chunks: string[]) => collect(parseSse(streamOf(chunks)));

describe('parseSse', () => {
  it('yields the data of each event', async () => {
    expect(await parse(['data: a\n\ndata: b\n\n'])).toEqual(['a', 'b']);
  });

  it('reassembles an event split across network chunks', async () => {
    expect(await parse(['da', 'ta: hel', 'lo\n', '\n'])).toEqual(['hello']);
  });

  it('handles CRLF line endings, including a CRLF split across chunks', async () => {
    expect(await parse(['data: a\r\n\r', '\ndata: b\r\n\r\n'])).toEqual(['a', 'b']);
  });

  it('joins multiple data lines of one event with a newline', async () => {
    expect(await parse(['data: one\ndata: two\n\n'])).toEqual(['one\ntwo']);
  });

  it('ignores comments and unrelated fields', async () => {
    expect(await parse([': keep-alive\n\nevent: ping\nid: 1\ndata: x\n\n'])).toEqual(['x']);
  });

  it('emits a final event that lacks the terminating blank line', async () => {
    expect(await parse(['data: tail'])).toEqual(['tail']);
  });

  it('keeps multi-byte characters intact when a chunk splits them', async () => {
    const bytes = new TextEncoder().encode('data: 你好\n\n');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, 8));
        controller.enqueue(bytes.slice(8));
        controller.close();
      },
    });
    expect(await collect(parseSse(stream))).toEqual(['你好']);
  });

  it('cancels the underlying stream when the consumer stops early', async () => {
    let cancelled = false;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('data: x\n\n'));
      },
      cancel() {
        cancelled = true;
      },
    });
    for await (const _ of parseSse(stream)) break;
    expect(cancelled).toBe(true);
  });
});
