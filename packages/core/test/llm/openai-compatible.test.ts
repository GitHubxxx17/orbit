import { describe, expect, it, vi } from 'vitest';
import { createOpenAICompatibleClient } from '../../src/llm/openai-compatible.js';
import { collect, event, sseResponse } from './helpers.js';
import { LlmError, type ChatRequest } from '../../src/llm/types.js';

const config = { baseUrl: 'https://llm.test/v1/', apiKey: 'sk-secret', model: 'test-model' };
const request: ChatRequest = { messages: [{ role: 'user', content: 'hi' }] };

const delta = (content: string) => event({ choices: [{ delta: { content } }] });
const done = 'data: [DONE]\n\n';

function client(response: Response | (() => Response)) {
  const fetchMock = vi.fn(async () => (typeof response === 'function' ? response() : response));
  return {
    fetchMock,
    llm: createOpenAICompatibleClient({ ...config, fetch: fetchMock as unknown as typeof fetch }),
  };
}

describe('createOpenAICompatibleClient', () => {
  it('streams text deltas and a finish event with usage', async () => {
    const { llm } = client(
      sseResponse([
        delta('Hel'),
        delta('lo'),
        event({ choices: [{ delta: {}, finish_reason: 'stop' }] }),
        event({ choices: [], usage: { prompt_tokens: 5, completion_tokens: 2 } }),
        done,
      ]),
    );
    expect(await collect(llm.stream(request))).toEqual([
      { type: 'text-delta', text: 'Hel' },
      { type: 'text-delta', text: 'lo' },
      { type: 'finish', reason: 'stop', usage: { promptTokens: 5, completionTokens: 2 } },
    ]);
  });

  it('assembles a tool call from fragments and orders calls by index', async () => {
    const tool = (index: number, fn: Record<string, string>, id?: string) =>
      event({
        choices: [{ delta: { tool_calls: [{ index, ...(id ? { id } : {}), function: fn }] } }],
      });
    const { llm } = client(
      sseResponse([
        tool(1, { name: 'grep', arguments: '{"q":' }, 'call_b'),
        tool(0, { name: 'read_file', arguments: '{"path"' }, 'call_a'),
        tool(0, { arguments: ':"a.ts"}' }),
        tool(1, { arguments: '"x"}' }),
        event({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
        done,
      ]),
    );
    const events = await collect(llm.stream(request));
    expect(events).toEqual([
      {
        type: 'tool-call',
        call: { id: 'call_a', name: 'read_file', arguments: '{"path":"a.ts"}' },
      },
      { type: 'tool-call', call: { id: 'call_b', name: 'grep', arguments: '{"q":"x"}' } },
      { type: 'finish', reason: 'tool_calls', usage: null },
    ]);
  });

  it('sends the expected request', async () => {
    const { llm, fetchMock } = client(sseResponse([done]));
    await collect(
      llm.stream({
        messages: [
          { role: 'system', content: 's' },
          {
            role: 'assistant',
            content: null,
            toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{}' }],
          },
          { role: 'tool', toolCallId: 'c1', content: 'ok' },
        ],
        tools: [{ name: 'read_file', description: 'Read', parameters: { type: 'object' } }],
        temperature: 0.2,
        maxTokens: 100,
      }),
    );
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://llm.test/v1/chat/completions');
    expect((init.headers as Record<string, string>)['authorization']).toBe('Bearer sk-secret');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'test-model',
      stream: true,
      stream_options: { include_usage: true },
      messages: [
        { role: 'system', content: 's' },
        {
          role: 'assistant',
          content: null,
          tool_calls: [
            { id: 'c1', type: 'function', function: { name: 'read_file', arguments: '{}' } },
          ],
        },
        { role: 'tool', tool_call_id: 'c1', content: 'ok' },
      ],
      tools: [
        {
          type: 'function',
          function: { name: 'read_file', description: 'Read', parameters: { type: 'object' } },
        },
      ],
      temperature: 0.2,
      max_tokens: 100,
    });
  });

  it('turns an HTTP error into an LlmError and redacts the key', async () => {
    const { llm } = client(new Response('bad key sk-secret', { status: 401 }));
    const error = await collect(llm.stream(request)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(LlmError);
    expect((error as LlmError).status).toBe(401);
    expect((error as LlmError).message).toContain('[redacted]');
    expect((error as LlmError).message).not.toContain('sk-secret');
  });

  it('rejects a chunk that is not valid JSON', async () => {
    const { llm } = client(sseResponse(['data: {oops\n\n']));
    await expect(collect(llm.stream(request))).rejects.toBeInstanceOf(LlmError);
  });

  it('passes the abort signal to fetch', async () => {
    const { llm, fetchMock } = client(sseResponse([done]));
    const controller = new AbortController();
    await collect(llm.stream(request, controller.signal));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
  });

  it('stops reading when the consumer breaks out of the stream', async () => {
    let cancelled = false;
    const encoder = new TextEncoder();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(encoder.encode(delta('x')));
      },
      cancel() {
        cancelled = true;
      },
    });
    const { llm } = client(new Response(body, { status: 200 }));
    for await (const _ of llm.stream(request)) break;
    expect(cancelled).toBe(true);
  });
});
