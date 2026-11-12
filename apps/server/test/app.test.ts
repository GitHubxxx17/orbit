import {
  createPolicy,
  defaultPolicyConfig,
  defineTool,
  InMemoryEventStore,
  ToolRegistry,
  type ChatMessage,
  type LlmClient,
} from '@orbit/core';
import type { OrbitEvent } from '@orbit/protocol';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApprovalBroker } from '../src/approvals.js';
import { createApp } from '../src/app.js';
import { BroadcastingStore } from '../src/broadcast-store.js';
import { createDemoLlm } from '../src/demo-llm.js';
import { RunManager, type RunStarter } from '../src/runs.js';

const json = { 'content-type': 'application/json' };

/** Like `app.request`, but sends the Host header a real HTTP client always sends. */
function call(app: ReturnType<typeof createApp>, path: string, init: RequestInit = {}) {
  const headers = { host: 'localhost', ...(init.headers as Record<string, string> | undefined) };
  return app.request(path, { ...init, headers });
}

function setup(overrides: Partial<RunStarter> = {}) {
  const store = new BroadcastingStore(new InMemoryEventStore());
  const runs: RunStarter = {
    modes: () => ['demo'],
    start: () => ({ runId: 'r1', sessionId: 's1' }),
    cancel: () => false,
    listSessions: () => [],
    sessionRuns: () => undefined,
    info: () => ({ workspace: '/w', workspaceName: 'w', liveModel: null }),
    ...overrides,
  };
  const approvals = new ApprovalBroker();
  return { store, approvals, app: createApp({ store, runs, approvals }) };
}

/** Read an SSE response to the end and parse the `data:` payloads. */
async function readEvents(res: Response): Promise<OrbitEvent[]> {
  const text = await res.text();
  return text
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => JSON.parse(line.slice(5)) as OrbitEvent);
}

describe('server app', () => {
  it('reports health', async () => {
    const { app } = setup();
    expect(await (await call(app, '/health')).json()).toEqual({ ok: true });
  });

  it('returns a run event log', async () => {
    const { app, store } = setup();
    store.append('r1', { type: 'message.delta', text: 'hi' });
    const body = (await (await call(app, '/runs/r1/events')).json()) as { events: unknown[] };
    expect(body.events).toHaveLength(1);
  });

  it('rejects an invalid after cursor', async () => {
    const { app } = setup();
    expect((await call(app, '/runs/r1/events?after=-1')).status).toBe(400);
  });

  it('rejects non-loopback host names', async () => {
    const { app } = setup();
    const res = await call(app, '/health', { headers: { host: 'evil.example.com' } });
    expect(res.status).toBe(403);
  });
});

describe('POST /runs', () => {
  it('starts a run and returns its id', async () => {
    const { app } = setup();
    const res = await call(app, '/runs', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ prompt: 'hello' }),
    });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ runId: 'r1', sessionId: 's1' });
  });

  it('passes the default demo mode through', async () => {
    let received: unknown;
    const { app } = setup({
      start: (request) => {
        received = request;
        return { runId: 'r1', sessionId: 's1' };
      },
    });
    await call(app, '/runs', { method: 'POST', headers: json, body: '{"prompt":" hi "}' });
    expect(received).toEqual({ prompt: 'hi', mode: 'demo', approval: 'ask' });
  });

  it('requires a JSON content type', async () => {
    const { app } = setup();
    const res = await call(app, '/runs', {
      method: 'POST',
      headers: { 'content-type': 'text/plain' },
      body: '{"prompt":"hi"}',
    });
    expect(res.status).toBe(415);
  });

  it.each([['not json'], ['{}'], ['{"prompt":""}'], ['{"prompt":"x","mode":"other"}']])(
    'rejects an invalid body: %s',
    async (body) => {
      const { app } = setup();
      const res = await call(app, '/runs', { method: 'POST', headers: json, body });
      expect(res.status).toBe(400);
    },
  );
});

describe('POST /runs/:id/cancel', () => {
  it('cancels a running run and 404s otherwise', async () => {
    const { app } = setup({ cancel: (id) => id === 'r1' });
    expect((await call(app, '/runs/r1/cancel', { method: 'POST' })).status).toBe(200);
    expect((await call(app, '/runs/zzz/cancel', { method: 'POST' })).status).toBe(404);
  });
});

describe('GET /runs/:id/stream', () => {
  it('404s for an unknown run', async () => {
    const { app } = setup();
    expect((await call(app, '/runs/none/stream')).status).toBe(404);
  });

  it('replays a finished run and closes', async () => {
    const { app, store } = setup();
    store.append('r1', { type: 'run.started', agentId: 'a', workspace: '/w' });
    store.append('r1', { type: 'message.delta', text: 'hi' });
    store.append('r1', { type: 'run.completed' });

    const events = await readEvents(await call(app, '/runs/r1/stream'));
    expect(events.map((e) => e.type)).toEqual(['run.started', 'message.delta', 'run.completed']);
  });

  it('resumes after a cursor without repeating events', async () => {
    const { app, store } = setup();
    store.append('r1', { type: 'run.started', agentId: 'a', workspace: '/w' });
    store.append('r1', { type: 'message.delta', text: 'hi' });
    store.append('r1', { type: 'run.completed' });

    const events = await readEvents(
      await call(app, '/runs/r1/stream', { headers: { 'last-event-id': '2' } }),
    );
    expect(events.map((e) => e.seq)).toEqual([3]);
  });

  it('follows events appended while connected', async () => {
    const { app, store } = setup();
    store.append('r1', { type: 'run.started', agentId: 'a', workspace: '/w' });

    const pending = readEvents(await call(app, '/runs/r1/stream'));
    setTimeout(() => {
      store.append('r1', { type: 'message.delta', text: 'live' });
      store.append('r1', { type: 'run.completed' });
    }, 10);

    expect((await pending).map((e) => e.type)).toEqual([
      'run.started',
      'message.delta',
      'run.completed',
    ]);
  });
});

describe('POST /runs/:id/approvals/:approvalId', () => {
  const ask = (approvals: ApprovalBroker) =>
    approvals.request({
      runId: 'r1',
      approvalId: 'a1',
      items: [{ callId: 'c1', tool: 'write_file', args: {}, preview: '+x' }],
    });
  const answer = (app: ReturnType<typeof createApp>, body: string, type = json) =>
    call(app, '/runs/r1/approvals/a1', { method: 'POST', headers: type, body });

  it('hands the answer to the waiting run', async () => {
    const { app, approvals } = setup();
    const waiting = ask(approvals);

    const res = await answer(app, JSON.stringify({ answers: { c1: 'allow' } }));
    expect(res.status).toBe(200);
    expect(await waiting).toEqual({ c1: 'allow' });
  });

  it('answers only once', async () => {
    const { app, approvals } = setup();
    void ask(approvals);
    const body = JSON.stringify({ answers: { c1: 'allow' } });
    expect((await answer(app, body)).status).toBe(200);
    expect((await answer(app, body)).status).toBe(404);
  });

  it('404s when nothing is waiting', async () => {
    const { app } = setup();
    expect((await answer(app, JSON.stringify({ answers: {} }))).status).toBe(404);
  });

  it('rejects answers about calls that were never asked, and keeps waiting', async () => {
    const { app, approvals } = setup();
    let settled = false;
    void ask(approvals).then(() => (settled = true));

    const res = await answer(app, JSON.stringify({ answers: { other: 'allow' } }));
    expect(res.status).toBe(400);
    await Promise.resolve();
    expect(settled).toBe(false);
  });

  it.each([['not json'], ['{}'], ['{"answers":{"c1":"maybe"}}']])('rejects %s', async (body) => {
    const { app, approvals } = setup();
    void ask(approvals);
    expect((await answer(app, body)).status).toBe(400);
  });

  it('requires a JSON content type', async () => {
    const { app, approvals } = setup();
    void ask(approvals);
    const res = await answer(app, '{"answers":{"c1":"allow"}}', {
      'content-type': 'text/plain',
    });
    expect(res.status).toBe(415);
  });

  it('stops waiting when the run is cancelled', async () => {
    const { approvals } = setup();
    const controller = new AbortController();
    const waiting = approvals.request(
      {
        runId: 'r1',
        approvalId: 'a1',
        items: [{ callId: 'c1', tool: 't', args: {}, preview: '' }],
      },
      controller.signal,
    );
    controller.abort();
    await expect(waiting).rejects.toThrow('aborted');
  });
});

describe('demo run end to end', () => {
  /** Harmless stand-ins keep these tests independent of the filesystem. */
  function stack() {
    const store = new BroadcastingStore(new InMemoryEventStore());
    const approvals = new ApprovalBroker();
    const written: string[] = [];
    const registry = new ToolRegistry();
    for (const name of ['list_dir', 'read_file']) {
      registry.register(
        defineTool({
          name,
          description: name,
          risk: 'read',
          schema: z.object({}),
          execute: async () => `${name} output`,
        }),
      );
    }
    registry.register(
      defineTool({
        name: 'write_file',
        description: 'write',
        risk: 'write',
        schema: z.object({ path: z.string(), content: z.string() }),
        preview: async ({ path }) => `+++ ${path}`,
        execute: async ({ path }) => {
          written.push(path);
          return `created ${path}`;
        },
      }),
    );
    const runs = new RunManager({
      store,
      registry,
      workspace: '/w',
      policy: createPolicy(defaultPolicyConfig),
      approver: approvals,
      demoLlm: createDemoLlm(0),
      newId: () => 'demo1',
    });
    return { store, approvals, written, app: createApp({ store, runs, approvals }) };
  }

  /** Start a run, answer its approval with `choice` as soon as it appears, return the events. */
  async function runWith(choice: 'allow' | 'deny') {
    const ctx = stack();
    const unsubscribe = ctx.store.subscribe('demo1', (event) => {
      if (event.type !== 'approval.requested') return;
      const answers = Object.fromEntries(event.items.map((item) => [item.callId, choice]));
      ctx.approvals.resolve('demo1', event.approvalId, answers);
    });

    const created = await call(ctx.app, '/runs', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ prompt: 'go', mode: 'demo' }),
    });
    expect(created.status).toBe(201);
    const events = await readEvents(await call(ctx.app, '/runs/demo1/stream'));
    unsubscribe();
    return { ...ctx, events };
  }

  it('pauses for approval and writes only after the user allows it', async () => {
    const { events, written } = await runWith('allow');

    expect(events[0]?.type).toBe('run.started');
    expect(events.at(-1)?.type).toBe('run.completed');
    expect(events.filter((e) => e.type === 'approval.requested')).toHaveLength(1);
    expect(
      events.flatMap((e) => (e.type === 'tool.decided' ? [`${e.decision}:${e.by}`] : [])),
    ).toEqual(['allow:policy', 'allow:policy', 'allow:user']);
    expect(written).toEqual(['.orbit-demo/notes.txt']);
  });

  it('does not write when the user rejects', async () => {
    const { events, written } = await runWith('deny');

    expect(events.at(-1)?.type).toBe('run.completed');
    expect(written).toEqual([]);
    expect(events.filter((e) => e.type === 'tool.result')).toHaveLength(2);
  });

  it('refuses live mode when it is not configured', async () => {
    const store = new BroadcastingStore(new InMemoryEventStore());
    const approvals = new ApprovalBroker();
    const app = createApp({
      store,
      approvals,
      runs: new RunManager({
        store,
        registry: new ToolRegistry(),
        workspace: '/w',
        demoLlm: createDemoLlm(0),
      }),
    });
    const res = await call(app, '/runs', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ prompt: 'x', mode: 'live' }),
    });
    expect(res.status).toBe(400);
  });
});

describe('sessions', () => {
  /** A model that always answers "ok" and remembers what it was shown. */
  function stack(hold?: Promise<void>) {
    const store = new BroadcastingStore(new InMemoryEventStore());
    const approvals = new ApprovalBroker();
    const seen: ChatMessage[][] = [];
    const llm: LlmClient = {
      async *stream(request) {
        seen.push([...request.messages]);
        await hold;
        yield { type: 'text-delta', text: 'ok' };
        yield { type: 'finish', reason: 'stop', usage: null };
      },
    };
    let runs = 0;
    const manager = new RunManager({
      store,
      registry: new ToolRegistry(),
      workspace: '/w',
      demoLlm: llm,
      newId: () => `run${++runs}`,
      newSessionId: () => 'session1',
    });
    return { store, seen, manager, app: createApp({ store, runs: manager, approvals }) };
  }

  const post = (app: ReturnType<typeof createApp>, body: object) =>
    call(app, '/runs', { method: 'POST', headers: json, body: JSON.stringify(body) });

  const finished = async (app: ReturnType<typeof createApp>, runId: string) =>
    readEvents(await call(app, `/runs/${runId}/stream`));

  it('starts a new session when none is given and returns its id', async () => {
    const { app } = stack();
    const res = await post(app, { prompt: 'one' });
    expect(await res.json()).toEqual({ runId: 'run1', sessionId: 'session1' });
  });

  it('shows the model the earlier turns of the same session', async () => {
    const { app, seen } = stack();
    await post(app, { prompt: 'first question' });
    await finished(app, 'run1');

    const second = await post(app, { prompt: 'second question', sessionId: 'session1' });
    expect(second.status).toBe(201);
    await finished(app, 'run2');

    expect(seen[1]?.map((m) => `${m.role}:${m.content}`)).toEqual([
      expect.stringMatching(/^system:/),
      'user:first question',
      'assistant:ok',
      'user:second question',
    ]);
  });

  it('keeps unrelated sessions apart', async () => {
    const { app, seen } = stack();
    await post(app, { prompt: 'first question' });
    await finished(app, 'run1');
    await post(app, { prompt: 'unrelated' });
    await finished(app, 'run2');

    expect(seen[1]?.map((m) => m.content)).not.toContain('first question');
  });

  it('refuses a session id the server never handed out', async () => {
    const { app } = stack();
    const res = await post(app, { prompt: 'x', sessionId: 'made-up' });
    expect(res.status).toBe(404);
  });

  it('refuses a second run while the session still has one going', async () => {
    let release = () => {};
    const { app } = stack(new Promise<void>((resolve) => (release = resolve)));
    await post(app, { prompt: 'one' });
    // The model is held back, so run1 is still going.
    const res = await post(app, { prompt: 'two', sessionId: 'session1' });
    expect(res.status).toBe(409);
    release();
  });

  it('rejects an empty session id', async () => {
    const { app } = stack();
    expect((await post(app, { prompt: 'x', sessionId: '' })).status).toBe(400);
  });

  it('lets the demo model prove it can see the earlier turn', async () => {
    const store = new BroadcastingStore(new InMemoryEventStore());
    const approvals = new ApprovalBroker();
    const manager = new RunManager({
      store,
      registry: new ToolRegistry(),
      workspace: '/w',
      demoLlm: createDemoLlm(0),
      newId: (() => {
        let n = 0;
        return () => `d${++n}`;
      })(),
      newSessionId: () => 's',
    });
    const app = createApp({ store, runs: manager, approvals });

    manager.start({ prompt: '你好', mode: 'demo' });
    await readEvents(await call(app, '/runs/d1/stream')); // wait for the first run to finish

    manager.start({ prompt: '再问一句', mode: 'demo', sessionId: 's' });
    const events = await readEvents(await call(app, '/runs/d2/stream'));
    const text = events.flatMap((e) => (e.type === 'message.delta' ? [e.text] : [])).join('');
    expect(text).toContain('第 2 条消息');
    expect(text).toContain('你好');
  });
});

describe('session list and info', () => {
  it('reports the workspace and available modes', async () => {
    const { app } = setup({
      modes: () => ['demo', 'live'],
      info: () => ({ workspace: '/home/me/proj', workspaceName: 'proj', liveModel: 'some-model' }),
    });
    expect(await (await call(app, '/info')).json()).toEqual({
      workspace: '/home/me/proj',
      workspaceName: 'proj',
      liveModel: 'some-model',
      modes: ['demo', 'live'],
    });
  });

  it('lists sessions', async () => {
    const summary = {
      sessionId: 's1',
      title: 'hello',
      snippet: 'hi',
      runCount: 1,
      status: 'idle' as const,
      updatedAt: 5,
    };
    const { app } = setup({ listSessions: () => [summary] });
    expect(await (await call(app, '/sessions')).json()).toEqual({ sessions: [summary] });
  });

  it('returns the runs of a session and 404s for an unknown one', async () => {
    const { app } = setup({ sessionRuns: (id) => (id === 's1' ? ['r1', 'r2'] : undefined) });
    expect(await (await call(app, '/sessions/s1')).json()).toEqual({
      sessionId: 's1',
      runIds: ['r1', 'r2'],
    });
    expect((await call(app, '/sessions/nope')).status).toBe(404);
  });

  it('passes the approval mode through, defaulting to ask', async () => {
    const received: unknown[] = [];
    const { app } = setup({
      start: (request) => {
        received.push(request);
        return { runId: 'r1', sessionId: 's1' };
      },
    });
    const post = (body: object) =>
      call(app, '/runs', { method: 'POST', headers: json, body: JSON.stringify(body) });
    await post({ prompt: 'a' });
    await post({ prompt: 'b', approval: 'readonly' });
    expect((await post({ prompt: 'c', approval: 'yolo' })).status).toBe(400);

    expect(received).toEqual([
      { prompt: 'a', mode: 'demo', approval: 'ask' },
      { prompt: 'b', mode: 'demo', approval: 'readonly' },
    ]);
  });
});

describe('read-only approval mode', () => {
  it('refuses a write without asking the user', async () => {
    const store = new BroadcastingStore(new InMemoryEventStore());
    const approvals = new ApprovalBroker();
    const written: string[] = [];
    const registry = new ToolRegistry();
    for (const name of ['list_dir', 'read_file']) {
      registry.register(
        defineTool({
          name,
          description: name,
          risk: 'read',
          schema: z.object({}),
          execute: async () => `${name} output`,
        }),
      );
    }
    registry.register(
      defineTool({
        name: 'write_file',
        description: 'write',
        risk: 'write',
        schema: z.object({ path: z.string(), content: z.string() }),
        preview: async () => '+x',
        execute: async ({ path }) => {
          written.push(path);
          return 'created';
        },
      }),
    );
    const manager = new RunManager({
      store,
      registry,
      workspace: '/w',
      policy: createPolicy(defaultPolicyConfig),
      approver: approvals,
      demoLlm: createDemoLlm(0),
      newId: () => 'run1',
    });
    const app = createApp({ store, runs: manager, approvals });

    manager.start({ prompt: 'go', mode: 'demo', approval: 'readonly' });
    const events = await readEvents(await call(app, '/runs/run1/stream'));

    expect(written).toEqual([]);
    expect(events.map((e) => e.type)).not.toContain('approval.requested');
    expect(events.at(-1)?.type).toBe('run.completed');
  });
});
