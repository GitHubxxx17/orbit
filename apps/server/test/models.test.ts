import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { InMemoryEventStore } from '@orbit/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ApprovalBroker } from '../src/approvals.js';
import { createApp } from '../src/app.js';
import { BroadcastingStore } from '../src/broadcast-store.js';
import { ModelManager, normalizeBaseUrl, SettingsError } from '../src/models.js';
import type { RunStarter } from '../src/runs.js';
import { SettingsStore } from '../src/settings.js';

const KEY = 'sk-super-secret-1234';
const input = { baseUrl: 'https://api.example.com/v1/', model: 'm1', apiKey: KEY };

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-settings-'));
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const file = () => path.join(dir, 'nested', 'settings.json');

function sse(): Response {
  const body = 'data: {"choices":[{"delta":{"content":"p"}}]}\n\ndata: [DONE]\n\n';
  return new Response(body, { headers: { 'content-type': 'text/event-stream' } });
}

function manager(extra: Partial<ConstructorParameters<typeof ModelManager>[0]> = {}) {
  let counter = 0;
  return new ModelManager({
    settings: new SettingsStore(file()),
    newId: () => `m-${(counter += 1)}`,
    ...extra,
  });
}

describe('normalizeBaseUrl', () => {
  it('trims trailing slashes and accepts https', () => {
    expect(normalizeBaseUrl(' https://api.example.com/v1/ ')).toBe('https://api.example.com/v1');
  });
  it('allows plain http only on loopback', () => {
    expect(normalizeBaseUrl('http://localhost:11434/v1')).toBe('http://localhost:11434/v1');
    expect(() => normalizeBaseUrl('http://api.example.com')).toThrow(SettingsError);
  });
  it('rejects other schemes, garbage and embedded credentials', () => {
    expect(() => normalizeBaseUrl('ftp://x.com')).toThrow(SettingsError);
    expect(() => normalizeBaseUrl('not a url')).toThrow(SettingsError);
    expect(() => normalizeBaseUrl('https://u:p@x.com')).toThrow(SettingsError);
  });
});

describe('ModelManager', () => {
  it('starts with no models', () => {
    const m = manager();
    expect(m.current()).toBeUndefined();
    expect(m.list()).toEqual({ models: [], defaultId: null });
  });

  it('saves a model, makes it the default, swaps the client at once and hides the key', () => {
    const m = manager();
    const list = m.save(undefined, input);
    expect(list).toEqual({
      models: [
        {
          id: 'm-1',
          label: 'm1',
          baseUrl: 'https://api.example.com/v1',
          model: 'm1',
          apiKeyHint: '1234',
          source: 'settings',
        },
      ],
      defaultId: 'm-1',
    });
    expect(JSON.stringify(list)).not.toContain(KEY);
    expect(m.current()?.name).toBe('m1');
  });

  it('keeps several models and picks one by id, the default when none is named', () => {
    const m = manager();
    m.save(undefined, input);
    m.save(undefined, { ...input, model: 'm2', label: 'Second' });
    expect(m.list().models.map((x) => x.label)).toEqual(['m1', 'Second']);
    expect(m.current()?.name).toBe('m1');
    expect(m.current('m-2')?.name).toBe('m2');
    expect(m.current('nope')).toBeUndefined();
    m.setDefault('m-2');
    expect(m.current()?.name).toBe('m2');
  });

  it('moves the default to the next model when the default is removed', () => {
    const m = manager();
    m.save(undefined, input);
    m.save(undefined, { ...input, model: 'm2' });
    expect(m.remove('m-1').defaultId).toBe('m-2');
    expect(m.remove('m-2')).toEqual({ models: [], defaultId: null });
    expect(m.current()).toBeUndefined();
  });

  it('refuses to change or remove a model that is not saved', () => {
    const m = manager();
    expect(() => m.save('ghost', input)).toThrow(SettingsError);
    expect(() => m.remove('ghost')).toThrow(SettingsError);
    expect(() => m.setDefault('ghost')).toThrow(SettingsError);
  });

  it('writes the file privately, and a new manager reads it back', () => {
    manager().save(undefined, input);
    expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file())).mode & 0o777).toBe(0o700);
    expect(fs.readdirSync(path.dirname(file()))).toEqual(['settings.json']);
    expect(manager().list().models[0]).toMatchObject({ source: 'settings', model: 'm1' });
  });

  it('keeps the stored key when an update leaves it out, and requires one for a new model', () => {
    const m = manager();
    expect(() => m.save(undefined, { baseUrl: input.baseUrl, model: 'm1' })).toThrow(SettingsError);
    m.save(undefined, input);
    m.save('m-1', { baseUrl: input.baseUrl, model: 'm2' });
    expect(m.list().models[0]).toMatchObject({ model: 'm2', apiKeyHint: '1234' });
  });

  it('reads a file written by the single-model version as one model', () => {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(
      file(),
      JSON.stringify({ model: { baseUrl: 'https://old.example.com', apiKey: KEY, model: 'old' } }),
    );
    const m = manager();
    expect(m.list()).toMatchObject({
      models: [{ id: 'default', label: 'old', model: 'old', source: 'settings' }],
      defaultId: 'default',
    });
    // The first save writes the new format and drops the old field.
    m.save(undefined, input);
    const written = JSON.parse(fs.readFileSync(file(), 'utf8')) as Record<string, unknown>;
    expect(written).not.toHaveProperty('model');
    expect(manager().list().models).toHaveLength(2);
  });

  it('uses the environment model only while nothing is saved', () => {
    const env = { baseUrl: 'https://env.example.com', apiKey: 'env-key-0000', model: 'env-model' };
    const m = manager({ env });
    expect(m.list()).toMatchObject({
      models: [{ id: 'env', source: 'env', model: 'env-model' }],
      defaultId: 'env',
    });
    expect(() => m.remove('env')).toThrow(SettingsError);
    m.save(undefined, input);
    expect(m.list().models.map((x) => x.source)).toEqual(['settings']);
    m.remove('m-1');
    expect(m.list().models[0]?.source).toBe('env');
  });

  it('treats a corrupt settings file as having no models', () => {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), '{nope');
    expect(manager().list().models).toEqual([]);
  });

  it('tests a connection without saving anything', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => sse());
    const m = manager({ fetch: fetchMock });
    const result = await m.test(input);
    expect(result).toMatchObject({ ok: true });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.example.com/v1/chat/completions',
    );
    expect(m.list().models).toEqual([]);
  });

  it('reuses the key of a named saved model, but never borrows the default’s key for a new one', async () => {
    const m = manager({ fetch: async () => sse() });
    m.save(undefined, input);
    const noKey = { baseUrl: input.baseUrl, model: 'm1' };
    await expect(m.test(noKey)).rejects.toThrow(SettingsError);
    expect(await m.test({ ...noKey, id: 'm-1' })).toMatchObject({ ok: true });
  });

  it('reports a provider failure without leaking the key', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(`bad key ${KEY}`, { status: 401 }),
    );
    const result = await manager({ fetch: fetchMock }).test(input);
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain(KEY);
  });

  it('adds a plain hint when the provider is rate limiting, and keeps its own text', async () => {
    const busy = vi.fn<typeof fetch>(
      async () => new Response('{"error":{"code":"1305"}}', { status: 429 }),
    );
    const result = await manager({ fetch: busy }).test(input);
    expect(result.ok).toBe(false);
    expect(result.message).toContain('1305');
    expect(result.message).toContain('稍后重试');
  });

  it('shows the network error code hidden behind "fetch failed"', async () => {
    const down = vi.fn<typeof fetch>(async () => {
      throw new TypeError('fetch failed', { cause: { code: 'ENOTFOUND' } });
    });
    const result = await manager({ fetch: down }).test(input);
    expect(result.message).toBe('fetch failed (ENOTFOUND)');
  });

  it('gives up on a hanging provider', async () => {
    const hang = vi.fn<typeof fetch>(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
        }),
    );
    const result = await manager({ fetch: hang, testTimeoutMs: 20 }).test(input);
    expect(result).toEqual({
      ok: false,
      message: expect.stringContaining('请求超时'),
      latencyMs: null,
    });
  });
});

describe('settings routes', () => {
  function setup() {
    const runs = {} as RunStarter;
    const models = manager({ fetch: async () => sse() });
    const app = createApp({
      store: new BroadcastingStore(new InMemoryEventStore()),
      runs,
      approvals: new ApprovalBroker(),
      models,
    });
    const send = (method: string, url: string, body?: unknown, type = 'application/json') =>
      app.request(url, {
        method,
        headers: { host: 'localhost', 'content-type': type },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      });
    return { send };
  }

  it('never returns a key from any route', async () => {
    const { send } = setup();
    const created = await send('POST', '/settings/models', input);
    expect(created.status).toBe(201);
    for (const res of [
      created,
      await send('PUT', '/settings/models/m-1', { ...input, model: 'm2' }),
      await send('GET', '/settings/models'),
      await send('POST', '/settings/models/test', input),
      await send('PUT', '/settings/default-model', { id: 'm-1' }),
      await send('DELETE', '/settings/models/m-1'),
    ]) {
      expect(await res.text()).not.toContain(KEY);
    }
  });

  it('adds, lists, changes the default and removes', async () => {
    const { send } = setup();
    await send('POST', '/settings/models', input);
    await send('POST', '/settings/models', { ...input, model: 'm2' });
    const set = await send('PUT', '/settings/default-model', { id: 'm-2' });
    expect(((await set.json()) as { defaultId: string }).defaultId).toBe('m-2');
    const del = await send('DELETE', '/settings/models/m-2');
    expect(((await del.json()) as { models: unknown[] }).models).toHaveLength(1);
  });

  it('answers 400 for unsafe or incomplete input, 404 for an unknown model and 415 for non-JSON', async () => {
    const { send } = setup();
    expect(
      (await send('POST', '/settings/models', { ...input, baseUrl: 'http://evil.com' })).status,
    ).toBe(400);
    expect((await send('POST', '/settings/models', { baseUrl: 'https://a.com' })).status).toBe(400);
    expect((await send('POST', '/settings/models', { ...input, apiKey: undefined })).status).toBe(
      400,
    );
    expect((await send('POST', '/settings/models', input, 'text/plain')).status).toBe(415);
    expect((await send('PUT', '/settings/models/ghost', input)).status).toBe(400);
    expect((await send('DELETE', '/settings/models/ghost')).status).toBe(404);
    expect((await send('PUT', '/settings/default-model', { id: 'ghost' })).status).toBe(404);
  });

  it('refuses a foreign Host', async () => {
    const app = createApp({
      store: new BroadcastingStore(new InMemoryEventStore()),
      runs: {} as RunStarter,
      approvals: new ApprovalBroker(),
      models: manager(),
    });
    const res = await app.request('/settings/models', { headers: { host: 'evil.com' } });
    expect(res.status).toBe(403);
  });
});
