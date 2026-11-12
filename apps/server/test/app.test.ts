import { defineTool, InMemoryEventStore, ToolRegistry } from '@orbit/core';
import type { OrbitEvent } from '@orbit/protocol';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';

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
    start: () => 'r1',
    cancel: () => false,
    ...overrides,
  };
  return { store, app: createApp({ store, runs }) };
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
    expect(await res.json()).toEqual({ runId: 'r1' });
  });

  it('passes the default demo mode through', async () => {
    let received: unknown;
    const { app } = setup({
      start: (request) => {
        received = request;
        return 'r1';
      },
    });
    await call(app, '/runs', { method: 'POST', headers: json, body: '{"prompt":" hi "}' });
    expect(received).toEqual({ prompt: 'hi', mode: 'demo' });
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

describe('demo run end to end', () => {
  it('streams a full run that shows allow, fail-safe and deny', async () => {
    const store = new BroadcastingStore(new InMemoryEventStore());
    // Harmless stand-ins keep this test independent of the filesystem.
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
    const runs = new RunManager({
      store,
      registry,
      workspace: '/w',
      demoLlm: createDemoLlm(0),
      newId: () => 'demo1',
    });
    const app = createApp({ store, runs });

    const created = await call(app, '/runs', {
      method: 'POST',
      headers: json,
      body: JSON.stringify({ prompt: 'go', mode: 'demo' }),
    });
    expect(created.status).toBe(201);

    const events = await readEvents(await call(app, '/runs/demo1/stream'));
    const types = events.map((e) => e.type);
    expect(types[0]).toBe('run.started');
    expect(types.at(-1)).toBe('run.completed');
    expect(events.filter((e) => e.type === 'tool.decided').map((e) => e.decision)).toEqual([
      'allow',
      'allow',
      'deny',
    ]);
  });

  it('refuses live mode when it is not configured', async () => {
    const store = new BroadcastingStore(new InMemoryEventStore());
    const app = createApp({
      store,
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
