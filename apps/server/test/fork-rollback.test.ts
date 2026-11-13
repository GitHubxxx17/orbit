import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  checkInvariants,
  InMemoryEventStore,
  InMemorySessionStore,
  ToolRegistry,
  type ChatMessage,
  type EventStore,
  type LlmClient,
  type SessionStore,
} from '@orbit/core';
import { openStores } from '@orbit/store-sqlite';
import { createRollback, createTools } from '@orbit/tools';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ApprovalBroker } from '../src/approvals.js';
import { createApp } from '../src/app.js';
import { BroadcastingStore } from '../src/broadcast-store.js';
import { RunManager } from '../src/runs.js';

const json = { 'content-type': 'application/json' };

let workspace: string;
beforeEach(async () => {
  workspace = await mkdtemp(path.join(tmpdir(), 'orbit-fork-'));
});
afterEach(async () => {
  await rm(workspace, { recursive: true, force: true });
});

/**
 * A model that, on every run, writes `<n>.txt` and then says "done n". It records what it was
 * shown so tests can check which history a conversation continues from.
 */
async function stack(
  backing: { events: EventStore; sessions: SessionStore } = {
    events: new InMemoryEventStore(),
    sessions: new InMemorySessionStore(),
  },
  /** Keeps ids apart when a second stack runs over the same database. */
  prefix = '',
) {
  const store = new BroadcastingStore(backing.events);
  const seen: ChatMessage[][] = [];
  let writes = 0;
  const llm: LlmClient = {
    async *stream(request) {
      seen.push([...request.messages]);
      const last = request.messages.at(-1);
      if (last?.role === 'tool') {
        yield { type: 'text-delta', text: `done ${writes}` };
        yield { type: 'finish', reason: 'stop', usage: null };
        return;
      }
      writes += 1;
      yield {
        type: 'tool-call',
        call: {
          id: `call${writes}`,
          name: 'write_file',
          arguments: JSON.stringify({ path: 'note.txt', content: `version ${writes}` }),
        },
      };
      yield { type: 'finish', reason: 'tool_calls', usage: null };
    },
  };
  const registry = new ToolRegistry();
  for (const tool of await createTools(workspace)) registry.register(tool);
  let runs = 0;
  let sessions = 0;
  const manager = new RunManager({
    store,
    sessions: backing.sessions,
    registry,
    workspace,
    demoLlm: llm,
    policy: () => 'allow',
    rollback: await createRollback(workspace),
    newId: () => `run${prefix}${++runs}`,
    newSessionId: () => `session${prefix}${++sessions}`,
  });
  const app = createApp({ store, runs: manager, approvals: new ApprovalBroker() });
  const post = (url: string, body: object = {}) =>
    app.request(url, {
      method: 'POST',
      headers: { host: 'localhost', ...json },
      body: JSON.stringify(body),
    });
  /** Ask something and wait for the run to end. */
  const ask = async (prompt: string, sessionId?: string) => {
    const res = await post('/runs', { prompt, ...(sessionId ? { sessionId } : {}) });
    const started = (await res.json()) as { runId: string; sessionId: string };
    await (
      await app.request(`/runs/${started.runId}/stream`, { headers: { host: 'localhost' } })
    ).text();
    return started;
  };
  const types = (runId: string) => store.read(runId).map((e) => e.type);
  const note = () => readFile(path.join(workspace, 'note.txt'), 'utf8');
  return { store, seen, manager, app, post, ask, types, note };
}

describe('rollback', () => {
  it('records the change, restores the old text, and notes the rollback in the log', async () => {
    const { ask, post, types, note, store } = await stack();
    await writeFile(path.join(workspace, 'note.txt'), 'original');
    const { runId } = await ask('write it');
    expect(await note()).toBe('version 1');
    expect(types(runId)).toContain('file.changed');

    const res = await post(`/runs/${runId}/changes/call1/rollback`);

    expect(res.status).toBe(200);
    expect(await note()).toBe('original');
    expect(store.read(runId).at(-1)).toMatchObject({ type: 'file.rolledback', callId: 'call1' });
  });

  it('deletes a file the agent created', async () => {
    const { ask, post, note } = await stack();
    const { runId } = await ask('write it');
    await post(`/runs/${runId}/changes/call1/rollback`);
    await expect(note()).rejects.toThrow();
  });

  it('refuses to undo the same change twice', async () => {
    const { ask, post } = await stack();
    const { runId } = await ask('write it');
    expect((await post(`/runs/${runId}/changes/call1/rollback`)).status).toBe(200);
    expect((await post(`/runs/${runId}/changes/call1/rollback`)).status).toBe(409);
  });

  it('refuses, and leaves the file alone, when it was edited since', async () => {
    const { ask, post, note, types } = await stack();
    const { runId } = await ask('write it');
    await writeFile(path.join(workspace, 'note.txt'), 'edited by hand');

    const res = await post(`/runs/${runId}/changes/call1/rollback`);

    expect(res.status).toBe(409);
    expect(await note()).toBe('edited by hand');
    expect(types(runId)).not.toContain('file.rolledback');
  });

  it('must go newest first when a file was written twice', async () => {
    const { ask, post, note } = await stack();
    const first = await ask('one');
    const second = await ask('two', first.sessionId);

    expect((await post(`/runs/${first.runId}/changes/call1/rollback`)).status).toBe(409);
    expect((await post(`/runs/${second.runId}/changes/call2/rollback`)).status).toBe(200);
    expect(await note()).toBe('version 1');
    expect((await post(`/runs/${first.runId}/changes/call1/rollback`)).status).toBe(200);
  });

  it('answers 404 for a change that does not exist, and 415 without JSON', async () => {
    const { ask, post, app } = await stack();
    const { runId } = await ask('write it');
    expect((await post(`/runs/${runId}/changes/nope/rollback`)).status).toBe(404);
    const plain = await app.request(`/runs/${runId}/changes/call1/rollback`, {
      method: 'POST',
      headers: { host: 'localhost' },
    });
    expect(plain.status).toBe(415);
  });
});

describe('fork', () => {
  it('copies the first runs into a new session and leaves the original alone', async () => {
    const { ask, post, manager, store } = await stack();
    const first = await ask('first question');
    await ask('second question', first.sessionId);

    const res = await post(`/sessions/${first.sessionId}/fork`, { upToRun: 1 });

    expect(res.status).toBe(201);
    const { sessionId } = (await res.json()) as { sessionId: string };
    expect(sessionId).not.toBe(first.sessionId);
    expect(manager.sessionRuns(first.sessionId)).toEqual(['run1', 'run2']);
    const forkRuns = manager.sessionRuns(sessionId) ?? [];
    expect(forkRuns).toHaveLength(1);
    const copy = store.read(forkRuns[0] ?? '');
    expect(copy.map((e) => e.type)).toEqual(
      store
        .read('run1')
        .map((e) => e.type)
        .filter((type) => type !== 'file.changed'),
    );
    expect(copy.every((e) => e.runId === forkRuns[0])).toBe(true);
    expect(manager.listSessions().find((s) => s.sessionId === sessionId)?.title).toBe(
      '分叉 · first question',
    );
  });

  it('does not copy file changes, so the fork cannot undo the original’s writes', async () => {
    const { ask, post, manager, types } = await stack();
    const first = await ask('write it');
    const { sessionId } = (await (
      await post(`/sessions/${first.sessionId}/fork`, { upToRun: 1 })
    ).json()) as { sessionId: string };

    const [copied] = manager.sessionRuns(sessionId) ?? [];
    expect(types(first.runId)).toContain('file.changed');
    expect(types(copied ?? '')).not.toContain('file.changed');
  });

  it('continues from the fork point: the model sees only the copied turns', async () => {
    const { ask, post, seen } = await stack();
    const first = await ask('first question');
    await ask('second question', first.sessionId);
    const { sessionId } = (await (
      await post(`/sessions/${first.sessionId}/fork`, { upToRun: 1 })
    ).json()) as { sessionId: string };

    seen.length = 0;
    await ask('a different second question', sessionId);

    const shown = (seen[0] ?? []).filter((m) => m.role === 'user').map((m) => m.content);
    expect(shown).toEqual(['first question', 'a different second question']);
  });

  it('rejects an out-of-range point and an unknown session', async () => {
    const { ask, post } = await stack();
    const first = await ask('only question');
    expect((await post(`/sessions/${first.sessionId}/fork`, { upToRun: 2 })).status).toBe(400);
    expect((await post(`/sessions/${first.sessionId}/fork`, { upToRun: 0 })).status).toBe(400);
    expect((await post('/sessions/nope/fork', { upToRun: 1 })).status).toBe(404);
  });
});

describe('with the SQLite stores', () => {
  it('forks, rolls back after a restart of the stack, and keeps the log consistent', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'orbit-sqlite-fork-'));
    const file = path.join(dir, 'orbit.db');
    try {
      const first = openStores(file);
      const one = await stack(first);
      const started = await one.ask('write it');
      first.close();

      // A fresh stack over the same database: what was recorded survives a restart.
      const second = openStores(file);
      const two = await stack(second, 'b');
      expect((await two.post(`/runs/${started.runId}/changes/call1/rollback`)).status).toBe(200);
      const forked = await two.post(`/sessions/${started.sessionId}/fork`, { upToRun: 1 });
      expect(forked.status).toBe(201);

      const events = second.events.read(started.runId);
      expect(checkInvariants(events)).toEqual([]);
      expect(events.at(-1)?.type).toBe('file.rolledback');
      second.close();
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });
});
