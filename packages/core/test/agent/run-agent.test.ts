import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { runAgent, type RunAgentOptions } from '../../src/agent/run-agent.js';
import { InMemoryEventStore } from '../../src/event-store.js';
import { checkInvariants } from '../../src/invariants.js';
import type { ChatRequest, LlmClient, LlmEvent } from '../../src/llm/types.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { defineTool } from '../../src/tools/tool.js';

/** A model that replays a fixed script: each call to `stream` consumes one turn. */
function scriptedLlm(turns: LlmEvent[][]): LlmClient & { requests: ChatRequest[] } {
  const requests: ChatRequest[] = [];
  let index = 0;
  return {
    requests,
    async *stream(request, signal) {
      requests.push({ ...request, messages: [...request.messages] });
      const turn = turns[index++] ?? [{ type: 'finish', reason: 'stop', usage: null }];
      for (const event of turn) {
        if (signal?.aborted) throw new Error('aborted');
        yield event;
      }
    },
  };
}

const finish = (reason: 'stop' | 'tool_calls' | 'length' = 'stop'): LlmEvent => ({
  type: 'finish',
  reason,
  usage: null,
});
const say = (text: string): LlmEvent => ({ type: 'text-delta', text });
const call = (id: string, name: string, args: unknown): LlmEvent => ({
  type: 'tool-call',
  call: { id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) },
});

const echo = defineTool({
  name: 'echo',
  description: 'Return the given text.',
  risk: 'read',
  schema: z.object({ text: z.string() }),
  execute: async ({ text }) => text,
});

function setup(turns: LlmEvent[][], overrides: Partial<RunAgentOptions> = {}) {
  let n = 0;
  const store = new InMemoryEventStore({ now: () => 1000 }, { next: () => `e${++n}` });
  const llm = scriptedLlm(turns);
  const registry = new ToolRegistry().register(echo);
  const options: RunAgentOptions = {
    runId: 'r1',
    agentId: 'test',
    workspace: '/ws',
    llm,
    store,
    registry,
    systemPrompt: 'be brief',
    prompt: 'hi',
    ...overrides,
  };
  return { store, llm, options };
}

const types = (store: InMemoryEventStore) => store.read('r1').map((e) => e.type);

describe('runAgent', () => {
  it('completes a plain answer and streams it as deltas', async () => {
    const { store, options } = setup([[say('he'), say('llo'), finish()]]);
    const result = await runAgent(options);

    expect(result).toEqual({ status: 'completed' });
    expect(types(store)).toEqual([
      'run.started',
      'message.delta',
      'message.delta',
      'run.completed',
    ]);
    expect(checkInvariants(store.read('r1'))).toEqual([]);
  });

  it('runs a tool and feeds the result back to the model', async () => {
    const { store, llm, options } = setup([
      [call('c1', 'echo', { text: 'ping' }), finish('tool_calls')],
      [say('done'), finish()],
    ]);
    const result = await runAgent(options);

    expect(result).toEqual({ status: 'completed' });
    expect(types(store)).toEqual([
      'run.started',
      'tool.requested',
      'tool.decided',
      'tool.result',
      'message.delta',
      'run.completed',
    ]);
    const second = llm.requests[1];
    expect(second?.messages.at(-1)).toEqual({ role: 'tool', toolCallId: 'c1', content: 'ping' });
    expect(checkInvariants(store.read('r1'))).toEqual([]);
  });

  it('sends tool specs derived from the zod schema', async () => {
    const { llm, options } = setup([[say('x'), finish()]]);
    await runAgent(options);

    const spec = llm.requests[0]?.tools?.[0];
    expect(spec?.name).toBe('echo');
    expect(spec?.parameters).toMatchObject({
      type: 'object',
      properties: { text: { type: 'string' } },
    });
    expect(spec?.parameters).not.toHaveProperty('$schema');
  });

  it('denies a tool the policy does not allow, without running it', async () => {
    let ran = false;
    const danger = defineTool({
      name: 'wipe',
      description: 'Dangerous.',
      risk: 'dangerous',
      schema: z.object({}),
      execute: async () => {
        ran = true;
        return 'gone';
      },
    });
    const { store, llm, options } = setup([
      [call('c1', 'wipe', {}), finish('tool_calls')],
      [say('ok'), finish()],
    ]);
    options.registry.register(danger);
    await runAgent(options);

    expect(ran).toBe(false);
    expect(types(store)).not.toContain('tool.result');
    expect(store.read('r1').find((e) => e.type === 'tool.decided')).toMatchObject({
      decision: 'deny',
      by: 'policy',
    });
    expect(llm.requests[1]?.messages.at(-1)).toMatchObject({ role: 'tool' });
    expect(checkInvariants(store.read('r1'))).toEqual([]);
  });

  it('denies an unknown tool even under a permissive policy', async () => {
    const { store, options } = setup(
      [
        [call('c1', 'nope', {}), finish('tool_calls')],
        [say('ok'), finish()],
      ],
      { policy: () => 'allow' },
    );
    await runAgent(options);

    expect(store.read('r1').find((e) => e.type === 'tool.decided')).toMatchObject({
      decision: 'deny',
    });
    expect(checkInvariants(store.read('r1'))).toEqual([]);
  });

  it('turns invalid arguments into a failed tool result the model can see', async () => {
    const { store, options } = setup([
      [call('c1', 'echo', { text: 42 }), finish('tool_calls')],
      [say('retry'), finish()],
    ]);
    const result = await runAgent(options);

    expect(result.status).toBe('completed');
    expect(store.read('r1').find((e) => e.type === 'tool.result')).toMatchObject({ ok: false });
  });

  it('survives malformed argument JSON', async () => {
    const { store, options } = setup([
      [call('c1', 'echo', '{not json'), finish('tool_calls')],
      [say('retry'), finish()],
    ]);
    const result = await runAgent(options);

    expect(result.status).toBe('completed');
    expect(store.read('r1').find((e) => e.type === 'tool.result')).toMatchObject({ ok: false });
    expect(checkInvariants(store.read('r1'))).toEqual([]);
  });

  it('records a throwing tool as a failed result and keeps going', async () => {
    const boom = defineTool({
      name: 'boom',
      description: 'Always fails.',
      risk: 'read',
      schema: z.object({}),
      execute: async () => {
        throw new Error('kaput');
      },
    });
    const { store, options } = setup([
      [call('c1', 'boom', {}), finish('tool_calls')],
      [say('sorry'), finish()],
    ]);
    options.registry.register(boom);
    const result = await runAgent(options);

    expect(result.status).toBe('completed');
    expect(store.read('r1').find((e) => e.type === 'tool.result')).toMatchObject({
      ok: false,
      output: 'Error: kaput',
    });
  });

  it('fails when the step limit is reached', async () => {
    const loop = [call('c', 'echo', { text: 'again' }), finish('tool_calls')];
    const { store, options } = setup([loop, loop, loop], { maxSteps: 2 });
    const result = await runAgent(options);

    expect(result).toEqual({
      status: 'failed',
      reason: 'stopped after reaching the limit of 2 steps',
    });
    expect(types(store).at(-1)).toBe('run.failed');
  });

  it('fails with "cancelled" when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { store, options } = setup([[say('x'), finish()]], { signal: controller.signal });
    const result = await runAgent(options);

    expect(result).toEqual({ status: 'failed', reason: 'cancelled' });
    expect(types(store)).toEqual(['run.started', 'run.failed']);
  });

  it('reports a model error as a failed run', async () => {
    const { store, options } = setup([]);
    options.llm = {
      // eslint-disable-next-line require-yield
      async *stream() {
        throw new Error('503 upstream');
      },
    };
    const result = await runAgent(options);

    expect(result).toEqual({ status: 'failed', reason: 'model error: 503 upstream' });
    expect(checkInvariants(store.read('r1'))).toEqual([]);
  });
});
