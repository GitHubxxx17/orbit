import { EARLY_STOP_PREFIX } from '@orbit/protocol';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import type { ApprovalRequest } from '../../src/agent/approval.js';
import { createPolicy, defaultPolicyConfig } from '../../src/agent/policy.js';
import { historyFromRuns } from '../../src/agent/history.js';
import { runAgent, type RunAgentOptions } from '../../src/agent/run-agent.js';
import { InMemoryEventStore } from '../../src/event-store.js';
import { checkInvariants } from '../../src/invariants.js';
import type { ChatRequest, LlmClient, LlmEvent } from '../../src/llm/types.js';
import { ToolRegistry } from '../../src/tools/registry.js';
import { reportTool } from '../../src/tools/report.js';
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
      'user.message',
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
      'user.message',
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

  it('asks for an answer from what it has when the safety ceiling is reached', async () => {
    const distinct = (n: number) => [
      call(`c${n}`, 'echo', { text: `t${n}` }),
      finish('tool_calls'),
    ];
    const { store, llm, options } = setup(
      [distinct(1), distinct(2), [say('Here is what I found.'), finish()]],
      { maxSteps: 2 },
    );
    const result = await runAgent(options);

    expect(result).toEqual({ status: 'failed', reason: `${EARLY_STOP_PREFIX}steps` });
    expect(types(store).at(-1)).toBe('run.failed');
    // The answer is in the log, before the failure.
    const text = store
      .read('r1')
      .flatMap((e) => (e.type === 'message.delta' ? [e.text] : []))
      .join('');
    expect(text).toContain('Here is what I found.');
    // The last request offered no tools and told the model why.
    const last = llm.requests.at(-1);
    expect(last?.tools).toBeUndefined();
    expect(last?.messages.at(-1)).toMatchObject({ role: 'user' });
    expect(String(last?.messages.at(-1)?.content)).toContain('safety limit of 2 model calls');
    expect(checkInvariants(store.read('r1'))).toEqual([]);
  });

  it('fails with "cancelled" when aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    const { store, options } = setup([[say('x'), finish()]], { signal: controller.signal });
    const result = await runAgent(options);

    expect(result).toEqual({ status: 'failed', reason: 'cancelled' });
    expect(types(store)).toEqual(['run.started', 'user.message', 'run.failed']);
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

describe('runAgent: approvals', () => {
  const written: string[] = [];
  const write = defineTool({
    name: 'write',
    description: 'Write a note.',
    risk: 'write',
    schema: z.object({ path: z.string(), text: z.string() }),
    preview: async ({ path, text }) => `+++ ${path}\n+${text}`,
    execute: async ({ path }) => {
      written.push(path);
      return `wrote ${path}`;
    },
  });
  const askPolicy = createPolicy(defaultPolicyConfig);

  const writeCall = (id: string, path: string) => call(id, 'write', { path, text: 'hi' });

  function withWrite(turns: LlmEvent[][], overrides: Partial<RunAgentOptions> = {}) {
    written.length = 0;
    const ctx = setup(turns, { policy: askPolicy, newApprovalId: () => 'a1', ...overrides });
    ctx.options.registry.register(write);
    return ctx;
  }

  it('pauses for the user, then runs what was allowed', async () => {
    const requests: ApprovalRequest[] = [];
    const { store, options } = withWrite(
      [
        [writeCall('c1', 'a.txt'), finish('tool_calls')],
        [say('done'), finish()],
      ],
      {
        approver: {
          request: async (request) => {
            requests.push(request);
            return { c1: 'allow' };
          },
        },
      },
    );
    const result = await runAgent(options);

    expect(result.status).toBe('completed');
    expect(written).toEqual(['a.txt']);
    expect(types(store)).toEqual([
      'run.started',
      'user.message',
      'tool.requested',
      'approval.requested',
      'tool.decided',
      'tool.result',
      'message.delta',
      'run.completed',
    ]);
    expect(requests[0]?.items[0]).toMatchObject({ callId: 'c1', preview: '+++ a.txt\n+hi' });
    expect(store.read('r1').find((e) => e.type === 'tool.decided')).toMatchObject({
      decision: 'allow',
      by: 'user',
    });
    expect(checkInvariants(store.read('r1'))).toEqual([]);
  });

  it('does not run a call the user rejected, and tells the model', async () => {
    const { store, llm, options } = withWrite(
      [
        [writeCall('c1', 'a.txt'), finish('tool_calls')],
        [say('ok'), finish()],
      ],
      { approver: { request: async () => ({ c1: 'deny' }) } },
    );
    await runAgent(options);

    expect(written).toEqual([]);
    expect(types(store)).not.toContain('tool.result');
    expect(llm.requests[1]?.messages.at(-1)).toMatchObject({
      role: 'tool',
      content: 'Denied: the user rejected "write".',
    });
    expect(checkInvariants(store.read('r1'))).toEqual([]);
  });

  it('asks once for all writes of a turn, and lets reads through the policy', async () => {
    const requests: ApprovalRequest[] = [];
    const { store, options } = withWrite(
      [
        [
          writeCall('c1', 'a.txt'),
          call('c2', 'echo', { text: 'x' }),
          writeCall('c3', 'b.txt'),
          finish('tool_calls'),
        ],
        [say('done'), finish()],
      ],
      {
        approver: {
          request: async (request) => {
            requests.push(request);
            return { c1: 'allow', c3: 'deny' };
          },
        },
      },
    );
    await runAgent(options);

    expect(requests).toHaveLength(1);
    expect(requests[0]?.items.map((i) => i.callId)).toEqual(['c1', 'c3']);
    expect(written).toEqual(['a.txt']);
    const decided = store
      .read('r1')
      .flatMap((e) => (e.type === 'tool.decided' ? [`${e.callId}:${e.decision}:${e.by}`] : []));
    expect(decided).toEqual(['c2:allow:policy', 'c1:allow:user', 'c3:deny:user']);
    expect(checkInvariants(store.read('r1'))).toEqual([]);
  });

  it('treats a call missing from the answer as refused', async () => {
    const { options } = withWrite(
      [
        [writeCall('c1', 'a.txt'), finish('tool_calls')],
        [say('ok'), finish()],
      ],
      { approver: { request: async () => ({}) } },
    );
    await runAgent(options);
    expect(written).toEqual([]);
  });

  it('refuses every ask when no approver is given', async () => {
    const { store, options } = withWrite([
      [writeCall('c1', 'a.txt'), finish('tool_calls')],
      [say('ok'), finish()],
    ]);
    await runAgent(options);

    expect(written).toEqual([]);
    expect(store.read('r1').find((e) => e.type === 'tool.decided')).toMatchObject({
      decision: 'deny',
      by: 'user',
    });
  });

  it('refuses a call with unusable arguments without bothering the user', async () => {
    let asked = false;
    const { store, options } = withWrite(
      [
        [call('c1', 'write', { path: 1 }), finish('tool_calls')],
        [say('ok'), finish()],
      ],
      {
        approver: {
          request: async () => {
            asked = true;
            return { c1: 'allow' };
          },
        },
      },
    );
    await runAgent(options);

    expect(asked).toBe(false);
    expect(types(store)).not.toContain('approval.requested');
    expect(store.read('r1').find((e) => e.type === 'tool.decided')).toMatchObject({
      decision: 'deny',
      by: 'policy',
    });
    expect(checkInvariants(store.read('r1'))).toEqual([]);
  });

  it('stops waiting when the run is cancelled', async () => {
    const controller = new AbortController();
    const { store, options } = withWrite([[writeCall('c1', 'a.txt'), finish('tool_calls')]], {
      signal: controller.signal,
      approver: {
        request: (_request, signal) =>
          new Promise((_resolve, reject) => {
            signal?.addEventListener('abort', () => reject(new Error('aborted')));
            setTimeout(() => controller.abort(), 5);
          }),
      },
    });
    const result = await runAgent(options);

    expect(result).toEqual({ status: 'failed', reason: 'cancelled' });
    expect(written).toEqual([]);
    expect(types(store).at(-1)).toBe('run.failed');
  });
});

describe('runAgent: conversation', () => {
  it('records what the user asked right after the run starts', async () => {
    const { store, options } = setup([[say('hi'), finish()]], { prompt: 'what is up' });
    await runAgent(options);

    expect(store.read('r1')[1]).toMatchObject({ type: 'user.message', text: 'what is up' });
  });

  it('sends earlier turns to the model between the system prompt and the new question', async () => {
    const { llm, options } = setup([[say('ok'), finish()]], {
      prompt: 'and now?',
      history: [
        { role: 'user', content: 'first question' },
        { role: 'assistant', content: 'first answer' },
      ],
    });
    await runAgent(options);

    expect(llm.requests[0]?.messages.map((m) => m.content)).toEqual([
      'be brief',
      'first question',
      'first answer',
      'and now?',
    ]);
  });

  it('rebuilds exactly what the model saw from the log of the run', async () => {
    const { store, llm, options } = setup([
      [say('looking'), call('c1', 'echo', { text: 'ping' }), finish('tool_calls')],
      [say('done'), finish()],
    ]);
    await runAgent(options);

    const seen = llm.requests[1]?.messages.slice(1); // without the system prompt
    expect(historyFromRuns([store.read('r1')]).slice(0, 3)).toEqual(seen);
  });

  it('trims what is sent to the model to the size budget, oldest exchanges first', async () => {
    const long = 'x'.repeat(400);
    const { llm, options } = setup([[say('ok'), finish()]], {
      maxContextChars: 300,
      history: [
        { role: 'user', content: 'old question' },
        { role: 'assistant', content: long },
      ],
    });
    await runAgent(options);

    expect(llm.requests[0]?.messages.map((m) => m.content)).toEqual(['be brief', 'hi']);
  });
});

describe('runAgent: file changes', () => {
  const touch = defineTool({
    name: 'touch',
    description: 'Pretend to write a file.',
    risk: 'write',
    schema: z.object({ path: z.string() }),
    execute: async ({ path }, context) => {
      context.recordChange?.({ path, before: null, after: 'x' });
      return 'ok';
    },
  });

  it('records a file.changed event for a change the tool reports, before its result', async () => {
    const { store, options } = setup(
      [
        [call('c1', 'touch', { path: 'a.txt' }), finish('tool_calls')],
        [say('done'), finish()],
      ],
      { policy: () => 'allow' },
    );
    options.registry.register(touch);
    await runAgent(options);

    const events = store.read('r1');
    const changed = events.find((e) => e.type === 'file.changed');
    expect(changed).toMatchObject({ callId: 'c1', path: 'a.txt', before: null, after: 'x' });
    const order = events.map((e) => e.type);
    expect(order.indexOf('file.changed')).toBeLessThan(order.indexOf('tool.result'));
    expect(checkInvariants(events)).toEqual([]);
  });

  it('records nothing for a call that was refused', async () => {
    const { store, options } = setup(
      [
        [call('c1', 'touch', { path: 'a.txt' }), finish('tool_calls')],
        [say('done'), finish()],
      ],
      { policy: () => 'deny' },
    );
    options.registry.register(touch);
    await runAgent(options);

    expect(types(store)).not.toContain('file.changed');
  });
});

describe('runAgent: report', () => {
  const claims = [
    { text: 'the echo returned ping', evidence: ['c1'] },
    { text: 'all tests pass', evidence: [] },
    { text: 'it also read the file', evidence: ['invented'] },
  ];

  it('answers the agent with which claims have evidence, so it can fix the report', async () => {
    const { store, options } = setup([
      [call('c1', 'echo', { text: 'ping' }), finish('tool_calls')],
      [call('c2', 'report', { claims }), finish('tool_calls')],
      [say('done'), finish()],
    ]);
    options.registry.register(reportTool());
    await runAgent(options);

    const result = store.read('r1').find((e) => e.type === 'tool.result' && e.callId === 'c2');
    expect(result).toMatchObject({ ok: true });
    const output = result?.type === 'tool.result' ? result.output : '';
    expect(output).toContain('3 claims, 1 supported, 0 partly supported, 2 without evidence');
    expect(output).toContain('invented: there is no such call in this run');
    expect(checkInvariants(store.read('r1'))).toEqual([]);
  });

  it('does not accept the report call as its own evidence', async () => {
    const { store, options } = setup([
      [
        call('c2', 'report', { claims: [{ text: 'self', evidence: ['c2'] }] }),
        finish('tool_calls'),
      ],
      [say('done'), finish()],
    ]);
    options.registry.register(reportTool());
    await runAgent(options);

    const result = store.read('r1').find((e) => e.type === 'tool.result');
    expect(result?.type === 'tool.result' ? result.output : '').toContain(
      'c2: that call cannot be used as evidence',
    );
  });

  it('refuses a report with no claims like any malformed call', async () => {
    const { store, options } = setup([
      [call('c2', 'report', { claims: [] }), finish('tool_calls')],
      [say('done'), finish()],
    ]);
    options.registry.register(reportTool());
    await runAgent(options);

    const result = store.read('r1').find((e) => e.type === 'tool.result');
    expect(result).toMatchObject({ ok: false });
  });
});

describe('runAgent: no practical step limit, but not stuck', () => {
  const again = (id: string) => [call(id, 'echo', { text: 'again' }), finish('tool_calls')];
  const distinct = (n: number) => [call(`c${n}`, 'echo', { text: `t${n}` }), finish('tool_calls')];

  it('lets a long job with different steps run to the end, far past the old limit of 10', async () => {
    const steps = Array.from({ length: 30 }, (_, n) => distinct(n));
    const { store, options } = setup([...steps, [say('done'), finish()]]);
    const result = await runAgent(options);

    expect(result).toEqual({ status: 'completed' });
    expect(store.read('r1').filter((e) => e.type === 'tool.result')).toHaveLength(30);
  });

  it('stops a model that repeats the same call with the same result, and takes its answer', async () => {
    const { store, llm, options } = setup([
      again('a'),
      again('b'),
      again('c'),
      [say('I kept getting the same thing.'), finish()],
    ]);
    const result = await runAgent(options);

    expect(result).toEqual({ status: 'failed', reason: `${EARLY_STOP_PREFIX}loop` });
    // Three identical calls ran; the fourth was never made.
    expect(store.read('r1').filter((e) => e.type === 'tool.result')).toHaveLength(3);
    const text = store
      .read('r1')
      .flatMap((e) => (e.type === 'message.delta' ? [e.text] : []))
      .join('');
    expect(text).toContain('I kept getting the same thing.');
    expect(llm.requests.at(-1)?.tools).toBeUndefined();
    expect(String(llm.requests.at(-1)?.messages.at(-1)?.content)).toContain(
      'same call with the same result 3 times',
    );
  });

  it('does not call it a loop when the same call gives a different result each time', async () => {
    let n = 0;
    const changing = defineTool({
      name: 'counter',
      description: 'Returns a new number each time.',
      risk: 'read',
      schema: z.object({}),
      execute: async () => String(++n),
    });
    const once = (id: string) => [call(id, 'counter', {}), finish('tool_calls')];
    const { options } = setup([once('a'), once('b'), once('c'), once('d'), [say('ok'), finish()]]);
    options.registry.register(changing);
    expect(await runAgent(options)).toEqual({ status: 'completed' });
  });

  it('counts arguments, not their spelling, so extra spaces still repeat', async () => {
    const withArgs = (id: string, args: string) => [
      { type: 'tool-call', call: { id, name: 'echo', arguments: args } } as LlmEvent,
      finish('tool_calls'),
    ];
    const { store, options } = setup([
      withArgs('a', '{"text":"x"}'),
      withArgs('b', '{ "text": "x" }'),
      withArgs('c', ' {"text":"x"} '),
      [say('stuck'), finish()],
    ]);
    const result = await runAgent(options);
    expect(result).toEqual({ status: 'failed', reason: `${EARLY_STOP_PREFIX}loop` });
    expect(store.read('r1').filter((e) => e.type === 'tool.result')).toHaveLength(3);
  });

  it('ignores a tool call the model makes after being told to stop', async () => {
    const { store, options } = setup([
      again('a'),
      again('b'),
      again('c'),
      [say('One more look.'), call('z', 'echo', { text: 'sneaky' }), finish('tool_calls')],
    ]);
    const result = await runAgent(options);

    expect(result).toEqual({ status: 'failed', reason: `${EARLY_STOP_PREFIX}loop` });
    expect(store.read('r1').some((e) => e.type === 'tool.requested' && e.callId === 'z')).toBe(
      false,
    );
  });

  it('still ends at once when the user stops, with no extra model call', async () => {
    const controller = new AbortController();
    const stopper = defineTool({
      name: 'stopper',
      description: 'Stops the run, as the Stop button does.',
      risk: 'read',
      schema: z.object({}),
      execute: async () => {
        controller.abort();
        return 'x';
      },
    });
    const { llm, options } = setup(
      [
        [call('s', 'stopper', {}), finish('tool_calls')],
        [say('more'), finish()],
      ],
      { signal: controller.signal },
    );
    options.registry.register(stopper);
    const result = await runAgent(options);

    expect(result).toEqual({ status: 'failed', reason: 'cancelled' });
    expect(llm.requests).toHaveLength(1);
  });

  it('keeps the answer in the history of the next turn', async () => {
    const { store, options } = setup([
      again('a'),
      again('b'),
      again('c'),
      [say('Partial answer.'), finish()],
    ]);
    await runAgent(options);

    const history = historyFromRuns([store.read('r1')]);
    expect(history.at(-1)).toMatchObject({ role: 'assistant', content: 'Partial answer.' });
  });
});
