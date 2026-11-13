import { InMemoryEventStore, ToolRegistry, type LlmClient } from '@orbit/core';
import { openStores } from '@orbit/store-sqlite';
import { describe, expect, it } from 'vitest';

import { ApprovalBroker } from '../src/approvals.js';
import { createApp } from '../src/app.js';
import { BroadcastingStore } from '../src/broadcast-store.js';
import { createDemoLlm } from '../src/demo-llm.js';
import { RunManager } from '../src/runs.js';

const llm: LlmClient = {
  async *stream() {
    yield { type: 'text-delta', text: 'ok' };
    yield { type: 'finish', reason: 'stop', usage: null };
  },
};

function stack() {
  const stores = openStores(':memory:');
  const store = new BroadcastingStore(stores.events);
  const runs = new RunManager({
    store,
    sessions: stores.sessions,
    registry: new ToolRegistry(),
    workspace: '/w',
    demoLlm: createDemoLlm(0),
    live: () => ({ llm, name: 'm' }),
  });
  const app = createApp({ store, runs, approvals: new ApprovalBroker() });
  const send = (method: string, url: string) =>
    app.request(url, { method, headers: { host: 'localhost' } });
  const done = async (runId: string) => {
    for (let i = 0; i < 50; i += 1) {
      if (store.read(runId).some((e) => e.type === 'run.completed' || e.type === 'run.failed')) {
        return;
      }
      await new Promise((r) => setTimeout(r, 5));
    }
  };
  const ask = async (text: string) => {
    const run = runs.start({ prompt: text, mode: 'live' });
    await done(run.runId);
    return run;
  };
  return { runs, store, send, ask, stores };
}

describe('the archive', () => {
  it('moves a conversation out of the list, and back, without losing anything', async () => {
    const { runs, ask, store } = stack();
    const run = await ask('hello');
    expect(runs.remove(run.sessionId)).toBe('ok');
    expect(runs.listSessions()).toEqual([]);
    expect(runs.listArchived().map((s) => s.sessionId)).toEqual([run.sessionId]);
    expect(runs.listArchived()[0]?.title).toBe('hello');
    // Archived is hidden, not deleted.
    expect(store.read(run.runId).length).toBeGreaterThan(0);

    expect(runs.restore(run.sessionId)).toBe('ok');
    expect(runs.listArchived()).toEqual([]);
    expect(runs.listSessions()).toHaveLength(1);
    expect(runs.restore(run.sessionId)).toBe('unknown');
  });

  it('deletes an archived conversation and its events for good', async () => {
    const { runs, ask, store } = stack();
    const gone = await ask('delete me');
    const kept = await ask('keep me');
    runs.remove(gone.sessionId);

    expect(runs.purge(gone.sessionId)).toBe('ok');
    expect(store.read(gone.runId)).toEqual([]);
    expect(runs.listArchived()).toEqual([]);
    expect(runs.restore(gone.sessionId)).toBe('unknown');
    expect(runs.purge(gone.sessionId)).toBe('unknown');
    // The other conversation is untouched.
    expect(store.read(kept.runId).length).toBeGreaterThan(0);
    expect(runs.listSessions().map((s) => s.sessionId)).toEqual([kept.sessionId]);
  });

  it('will not delete a conversation that is still in the list', async () => {
    const { runs, ask, store } = stack();
    const live = await ask('in use');
    expect(runs.purge(live.sessionId)).toBe('unknown');
    expect(store.read(live.runId).length).toBeGreaterThan(0);
  });

  it('is available over HTTP: list, restore, delete', async () => {
    const { runs, ask, send } = stack();
    const a = await ask('first');
    const b = await ask('second');
    runs.remove(a.sessionId);
    runs.remove(b.sessionId);

    const listed = (await (await send('GET', '/archive')).json()) as { sessions: unknown[] };
    expect(listed.sessions).toHaveLength(2);
    expect((await send('POST', `/archive/${a.sessionId}/restore`)).status).toBe(200);
    expect((await send('DELETE', `/archive/${b.sessionId}`)).status).toBe(200);
    expect((await send('DELETE', `/archive/${b.sessionId}`)).status).toBe(404);
    expect((await send('POST', '/archive/nope/restore')).status).toBe(404);
    expect(await (await send('GET', '/archive')).json()).toEqual({ sessions: [] });
  });

  it('works with the in-memory stores too', async () => {
    const store = new BroadcastingStore(new InMemoryEventStore());
    const runs = new RunManager({
      store,
      registry: new ToolRegistry(),
      workspace: '/w',
      demoLlm: createDemoLlm(0),
      live: () => ({ llm, name: 'm' }),
    });
    const run = runs.start({ prompt: 'x', mode: 'live' });
    await new Promise((resolve) => setTimeout(resolve, 50)); // let the run finish
    expect(runs.remove(run.sessionId)).toBe('ok');
    expect(runs.purge(run.sessionId)).toBe('ok');
    expect(store.read(run.runId)).toEqual([]);
  });
});
