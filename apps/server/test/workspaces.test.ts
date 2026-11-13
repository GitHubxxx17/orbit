import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import {
  defineTool,
  InMemoryEventStore,
  ToolRegistry,
  type ChatRequest,
  type LlmClient,
} from '@orbit/core';
import type { OrbitEvent } from '@orbit/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ApprovalBroker } from '../src/approvals.js';
import { createApp } from '../src/app.js';
import { BroadcastingStore } from '../src/broadcast-store.js';
import { createDemoLlm } from '../src/demo-llm.js';
import { RunManager, RunRejected, type RunWorkspace, type WorkspaceSource } from '../src/runs.js';
import { pickFolder } from '../src/folder-picker.js';
import { WorkspaceError, WorkspaceManager } from '../src/workspaces.js';

let dir: string;
beforeEach(() => {
  dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-ws-')));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const mkdir = (name: string) => {
  const folder = path.join(dir, name);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
};
const config = () => path.join(dir, 'workspaces.json');
const write = (data: unknown) => fs.writeFileSync(config(), JSON.stringify(data));

const shared = defineTool({
  name: 'report',
  description: 'report',
  risk: 'read',
  schema: z.object({}),
  execute: async () => 'ok',
});

const create = (primary: string, picker?: () => Promise<string | null>) =>
  WorkspaceManager.create({
    primary,
    file: config(),
    sharedTools: () => [shared],
    ...(picker ? { picker } : {}),
  });

describe('WorkspaceManager', () => {
  it('always has the starting folder first, with its own tools and the shared ones', async () => {
    const a = mkdir('a');
    const manager = await create(a);
    const names = manager
      .primary()
      .registry.list()
      .map((t) => t.name);
    expect(names).toEqual(expect.arrayContaining(['read_file', 'write_file', 'report']));
    expect(manager.list()).toMatchObject({
      workspaces: [{ name: 'a', path: a }],
      errors: [],
    });
    expect(manager.list().defaultId).toBe(manager.primary().id);
  });

  it('adds the folders from the config file, with a stable id', async () => {
    const a = mkdir('a');
    const b = mkdir('b');
    write({ workspaces: [{ name: 'Beta', path: b }] });
    const manager = await create(a);
    expect(manager.list().workspaces.map((w) => w.name)).toEqual(['a', 'Beta']);
    const again = await create(a);
    expect(again.list().workspaces[1]?.id).toBe(manager.list().workspaces[1]?.id);
  });

  it('skips and reports what is not usable, without stopping the rest', async () => {
    const a = mkdir('a');
    const file = path.join(dir, 'file.txt');
    fs.writeFileSync(file, 'x');
    write({
      workspaces: [
        { path: 'relative/dir' },
        { path: path.join(dir, 'missing') },
        { path: file },
        { path: os.homedir() },
        { path: path.parse(dir).root },
        { path: a },
        { path: mkdir('ok') },
      ],
    });
    const manager = await create(a);
    const list = manager.list();
    // The starting folder is not added twice; only the good one is added.
    expect(list.workspaces.map((w) => w.name)).toEqual(['a', 'ok']);
    const messages = list.errors.map((e) => e.message).join('|');
    expect(messages).toContain('绝对路径');
    expect(messages).toContain('目录不存在');
    expect(messages).toContain('不是目录');
    expect(messages).toContain('主目录');
    expect(messages).toContain('根目录');
  });

  it('reports a damaged or misshapen config file and still works', async () => {
    const a = mkdir('a');
    fs.writeFileSync(config(), '{nope');
    expect((await create(a)).list().errors).toHaveLength(1);
    write({ workspaces: 'x' });
    const manager = await create(a);
    expect(manager.list().errors).toHaveLength(1);
    expect(manager.list().workspaces).toHaveLength(1);
  });

  it('finds a workspace by id or by the path a run recorded, and nothing else', async () => {
    const a = mkdir('a');
    const b = mkdir('b');
    write({ workspaces: [{ path: b }] });
    const manager = await create(a);
    const second = manager.list().workspaces[1]!;
    expect(manager.resolve(second.id)?.path).toBe(b);
    expect(manager.resolve()).toBe(manager.primary());
    expect(manager.resolve(b)).toBeUndefined();
    expect(manager.byPath(b)?.id).toBe(second.id);
    expect(manager.byPath(path.join(dir, 'elsewhere'))).toBeUndefined();
  });

  it('keeps each workspace’s tools inside its own folder', async () => {
    const a = mkdir('a');
    const b = mkdir('b');
    fs.writeFileSync(path.join(a, 'only-a.txt'), 'A');
    fs.writeFileSync(path.join(b, 'only-b.txt'), 'B');
    write({ workspaces: [{ path: b }] });
    const manager = await create(a);
    const read = (index: number, file: string) =>
      manager
        .resolve(manager.list().workspaces[index]?.id)!
        .registry.get('read_file')!
        .run({ path: file }, { signal: new AbortController().signal });
    expect(await read(0, 'only-a.txt')).toContain('A');
    await expect(read(0, 'only-b.txt')).rejects.toThrow();
    expect(await read(1, 'only-b.txt')).toContain('B');
  });
});

describe('choosing a folder in the dialog', () => {
  it('registers what the user chose, saves it, and a new manager reads it back', async () => {
    const a = mkdir('a');
    const b = mkdir('b');
    const manager = await create(a, async () => b);
    const result = await manager.pickAndAdd('Beta');
    expect(result.added).toMatchObject({ path: b });
    expect(manager.list().workspaces.map((w) => w.path)).toEqual([a, b]);
    expect(fs.statSync(config()).mode & 0o777).toBe(0o600);
    expect((await create(a)).list().workspaces.map((w) => w.path)).toEqual([a, b]);
    // The new folder is usable at once, without a restart.
    expect(manager.resolve(result.added!.id)?.registry.get('read_file')).toBeDefined();
  });

  it('answers "cancelled" without changing anything', async () => {
    const a = mkdir('a');
    const manager = await create(a, async () => null);
    expect((await manager.pickAndAdd()).added).toBeNull();
    expect(fs.existsSync(config())).toBe(false);
  });

  it('refuses a folder that is too broad or missing, with 400', async () => {
    const a = mkdir('a');
    for (const bad of [os.homedir(), path.parse(dir).root, path.join(dir, 'missing')]) {
      const manager = await create(a, async () => bad);
      await expect(manager.pickAndAdd()).rejects.toMatchObject({ status: 400 });
    }
    expect(fs.existsSync(config())).toBe(false);
  });

  it('returns the existing entry when the folder is already registered', async () => {
    const a = mkdir('a');
    const manager = await create(a, async () => a);
    const result = await manager.pickAndAdd();
    expect(result.added?.id).toBe(manager.primary().id);
    expect(manager.list().workspaces).toHaveLength(1);
  });

  it('allows one dialog at a time, and says so when the dialog is not supported', async () => {
    const a = mkdir('a');
    let release: (value: string | null) => void = () => undefined;
    const manager = await create(a, () => new Promise((resolve) => (release = resolve)));
    const first = manager.pickAndAdd();
    await expect(manager.pickAndAdd()).rejects.toMatchObject({ status: 409 });
    release(null);
    await first;

    const unsupported = await create(a, () => pickFolder('linux'));
    await expect(unsupported.pickAndAdd()).rejects.toMatchObject({ status: 501 });
  });

  it('never overwrites a config file it could not read', async () => {
    const a = mkdir('a');
    fs.writeFileSync(config(), '{nope');
    const manager = await create(a, async () => mkdir('b'));
    await expect(manager.pickAndAdd()).rejects.toBeInstanceOf(WorkspaceError);
    expect(fs.readFileSync(config(), 'utf8')).toBe('{nope');
  });

  it('removes a workspace without touching its folder or the other entries', async () => {
    const a = mkdir('a');
    const b = mkdir('b');
    const c = mkdir('c');
    write({ workspaces: [{ path: b }, { path: c, name: 'Gamma' }] });
    const manager = await create(a);
    const bId = manager.list().workspaces[1]!.id;
    expect(manager.remove(bId).workspaces.map((w) => w.path)).toEqual([a, c]);
    expect(fs.existsSync(b)).toBe(true);
    expect(JSON.parse(fs.readFileSync(config(), 'utf8'))).toEqual({
      workspaces: [{ path: c, name: 'Gamma' }],
    });
    expect(() => manager.remove(manager.primary().id)).toThrow(/启动目录/);
    expect(() => manager.remove('w-nope')).toThrow(WorkspaceError);
  });
});

describe('the folder dialog command', () => {
  const run = (stdout: string, error: Error | null = null) => {
    const calls: { file: string; args: string[] }[] = [];
    const result = pickFolder('darwin', (file, args, _options, callback) => {
      calls.push({ file, args });
      callback(error, stdout);
    });
    return { result, calls };
  };

  it('reads the chosen folder from the command output', async () => {
    const { result, calls } = run('/Users/me/app/\n');
    expect(await result).toBe('/Users/me/app');
    // Fixed arguments, no shell: nothing from a request can reach the command.
    expect(calls[0]?.file).toBe('osascript');
    expect(calls[0]?.args.every((arg, i) => (i % 2 === 0 ? arg === '-e' : true))).toBe(true);
  });

  it('treats cancelling as an answer and other failures as errors', async () => {
    expect(await run('', new Error('execution error: User canceled. (-128)')).result).toBeNull();
    await expect(run('', new Error('boom')).result).rejects.toThrow('boom');
  });

  it('is not available outside macOS', async () => {
    await expect(pickFolder('win32')).rejects.toMatchObject({ name: 'PickerUnsupported' });
  });
});

describe('GET /workspaces', () => {
  it('lists them read-only', async () => {
    const a = mkdir('a');
    const manager = await create(a);
    const app = createApp({
      store: new BroadcastingStore(new InMemoryEventStore()),
      runs: {} as never,
      approvals: new ApprovalBroker(),
      workspaces: manager,
    });
    const res = await app.request('/workspaces', { headers: { host: 'localhost' } });
    expect(res.status).toBe(200);
    expect(((await res.json()) as { workspaces: unknown[] }).workspaces).toHaveLength(1);
  });

  it('has no route that takes a path: the only thing a request may say is a name', async () => {
    const a = mkdir('a');
    const manager = await create(a, async () => mkdir('b'));
    const app = createApp({
      store: new BroadcastingStore(new InMemoryEventStore()),
      runs: {} as never,
      approvals: new ApprovalBroker(),
      workspaces: manager,
    });
    const send = (method: string, url: string, body?: unknown, type = 'application/json') =>
      app.request(url, {
        method,
        headers: { host: 'localhost', 'content-type': type },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });

    expect((await send('POST', '/workspaces', { path: '/etc' })).status).toBe(404);
    expect((await send('POST', '/workspaces/pick', { path: '/etc' })).status).toBe(400);
    expect((await send('POST', '/workspaces/pick', {}, 'text/plain')).status).toBe(415);
    const picked = await send('POST', '/workspaces/pick', { name: 'Beta' });
    expect(picked.status).toBe(200);
    const body = (await picked.json()) as { added: { id: string } | null };
    expect(body.added).not.toBeNull();
    expect((await send('DELETE', `/workspaces/${body.added!.id}`)).status).toBe(200);
    expect((await send('DELETE', '/workspaces/w-nope')).status).toBe(404);
    expect((await send('DELETE', `/workspaces/${manager.primary().id}`)).status).toBe(400);
  });
});

describe('runs and workspaces', () => {
  function stack() {
    const requests: ChatRequest[] = [];
    const llm: LlmClient = {
      async *stream(request) {
        requests.push(request);
        yield { type: 'text-delta', text: 'ok' };
        yield { type: 'finish', reason: 'stop', usage: null };
      },
    };
    const rolled: string[] = [];
    const make = (id: string, name: string, p: string): RunWorkspace => ({
      id,
      name,
      path: p,
      registry: new ToolRegistry(),
      rollback: async (change) => {
        rolled.push(`${id}:${change.path}`);
      },
    });
    const one = make('w-1', 'one', '/work/one');
    const two = make('w-2', 'two', '/work/two');
    const source: WorkspaceSource = {
      primary: () => one,
      resolve: (id) => [one, two].find((w) => w.id === (id ?? one.id)),
      byPath: (p) => [one, two].find((w) => w.path === p),
    };
    const store = new BroadcastingStore(new InMemoryEventStore());
    const runs = new RunManager({
      store,
      registry: one.registry,
      workspace: one.path,
      workspaces: source,
      demoLlm: createDemoLlm(0),
      live: () => ({ llm, name: 'm' }),
    });
    const done = async (run: { runId: string }) => {
      for (let i = 0; i < 50; i += 1) {
        const events = store.read(run.runId);
        if (events.some((e) => e.type === 'run.completed' || e.type === 'run.failed'))
          return events;
        await new Promise((r) => setTimeout(r, 5));
      }
      return store.read(run.runId);
    };
    const started = (events: OrbitEvent[]) =>
      events[0] as Extract<OrbitEvent, { type: 'run.started' }>;
    return { runs, store, done, started, rolled, source };
  }

  it('starts a new conversation in the default workspace, or in a registered one by id', async () => {
    const { runs, done, started } = stack();
    expect(started(await done(runs.start({ prompt: 'x', mode: 'live' }))).workspace).toBe(
      '/work/one',
    );
    expect(
      started(await done(runs.start({ prompt: 'x', mode: 'live', workspaceId: 'w-2' }))).workspace,
    ).toBe('/work/two');
  });

  it('refuses a workspace that is not registered, and a path in place of an id', () => {
    const { runs } = stack();
    expect(() => runs.start({ prompt: 'x', mode: 'live', workspaceId: 'w-9' })).toThrow(
      RunRejected,
    );
    expect(() => runs.start({ prompt: 'x', mode: 'live', workspaceId: '/etc' })).toThrow(
      RunRejected,
    );
  });

  it('keeps a conversation in the workspace it started in', async () => {
    const { runs, done, started } = stack();
    const first = runs.start({ prompt: 'x', mode: 'live', workspaceId: 'w-2' });
    await done(first);
    const next = runs.start({ prompt: 'y', mode: 'live', sessionId: first.sessionId });
    expect(started(await done(next)).workspace).toBe('/work/two');
    expect(() =>
      runs.start({ prompt: 'z', mode: 'live', sessionId: first.sessionId, workspaceId: 'w-1' }),
    ).toThrow(/keeps its workspace/);
  });

  it('refuses to continue a conversation whose workspace is no longer registered', async () => {
    const { runs, done, source } = stack();
    const first = runs.start({ prompt: 'x', mode: 'live', workspaceId: 'w-2' });
    await done(first);
    source.byPath = (p) => (p === '/work/one' ? source.primary() : undefined);
    expect(() => runs.start({ prompt: 'y', mode: 'live', sessionId: first.sessionId })).toThrow(
      /no longer registered/,
    );
  });

  it('shows each conversation under the name of its workspace', async () => {
    const { runs, done } = stack();
    await done(runs.start({ prompt: 'a', mode: 'live', workspaceId: 'w-2' }));
    await done(runs.start({ prompt: 'b', mode: 'live' }));
    const names = runs
      .listSessions()
      .map((s) => s.workspaceName)
      .sort();
    expect(names).toEqual(['one', 'two']);
  });

  it('undoes a write inside the workspace the run worked in', async () => {
    const { runs, done, store, rolled } = stack();
    const run = runs.start({ prompt: 'x', mode: 'live', workspaceId: 'w-2' });
    await done(run);
    store.append(run.runId, {
      type: 'file.changed',
      callId: 'c1',
      path: 'a.txt',
      before: null,
      after: 'x',
    } as never);
    expect(await runs.rollback(run.runId, 'c1')).toEqual({ status: 'ok' });
    expect(rolled).toEqual(['w-2:a.txt']);
  });
});
