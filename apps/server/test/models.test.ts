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
  return new ModelManager({ settings: new SettingsStore(file()), ...extra });
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
  it('starts unconfigured', () => {
    const m = manager();
    expect(m.current()).toBeUndefined();
    expect(m.status()).toMatchObject({ configured: false, source: 'none' });
  });

  it('saves, swaps the live client at once and hides the key', () => {
    const m = manager();
    const status = m.save(input);
    expect(status).toEqual({
      configured: true,
      source: 'settings',
      baseUrl: 'https://api.example.com/v1',
      model: 'm1',
      apiKeyHint: '1234',
    });
    expect(JSON.stringify(status)).not.toContain(KEY);
    expect(m.current()?.name).toBe('m1');
  });

  it('writes the file privately, and a new manager reads it back', () => {
    manager().save(input);
    expect(fs.statSync(file()).mode & 0o777).toBe(0o600);
    expect(fs.statSync(path.dirname(file())).mode & 0o777).toBe(0o700);
    expect(fs.readdirSync(path.dirname(file()))).toEqual(['settings.json']);
    expect(manager().status()).toMatchObject({ source: 'settings', model: 'm1' });
  });

  it('keeps the stored key when an update leaves it out, and requires one when there is none', () => {
    const m = manager();
    expect(() => m.save({ baseUrl: input.baseUrl, model: 'm1' })).toThrow(SettingsError);
    m.save(input);
    m.save({ baseUrl: input.baseUrl, model: 'm2' });
    expect(m.status()).toMatchObject({ model: 'm2', apiKeyHint: '1234' });
  });

  it('prefers saved settings over the environment and falls back after clearing', () => {
    const env = { baseUrl: 'https://env.example.com', apiKey: 'env-key-0000', model: 'env-model' };
    const m = manager({ env });
    expect(m.status()).toMatchObject({ source: 'env', model: 'env-model' });
    m.save(input);
    expect(m.status().source).toBe('settings');
    expect(m.clear()).toMatchObject({ source: 'env', model: 'env-model' });
    expect(manager().clear().configured).toBe(false);
  });

  it('treats a corrupt settings file as not configured', () => {
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), '{nope');
    expect(manager().status().configured).toBe(false);
  });

  it('tests a connection without saving anything', async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => sse());
    const m = manager({ fetch: fetchMock });
    const result = await m.test(input);
    expect(result).toMatchObject({ ok: true });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      'https://api.example.com/v1/chat/completions',
    );
    expect(m.status().configured).toBe(false);
  });

  it('reports a provider failure without leaking the key', async () => {
    const fetchMock = vi.fn<typeof fetch>(
      async () => new Response(`bad key ${KEY}`, { status: 401 }),
    );
    const result = await manager({ fetch: fetchMock }).test(input);
    expect(result.ok).toBe(false);
    expect(result.message).not.toContain(KEY);
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
    expect(result).toEqual({ ok: false, message: '请求超时', latencyMs: null });
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

  it('never returns the key from any route', async () => {
    const { send } = setup();
    const put = await send('PUT', '/settings/model', input);
    expect(put.status).toBe(200);
    for (const res of [
      put,
      await send('GET', '/settings/model'),
      await send('POST', '/settings/model/test', input),
      await send('DELETE', '/settings/model'),
    ]) {
      expect(await res.text()).not.toContain(KEY);
    }
  });

  it('answers 400 for unsafe or incomplete input and 415 for non-JSON', async () => {
    const { send } = setup();
    expect(
      (await send('PUT', '/settings/model', { ...input, baseUrl: 'http://evil.com' })).status,
    ).toBe(400);
    expect((await send('PUT', '/settings/model', { baseUrl: 'https://a.com' })).status).toBe(400);
    expect((await send('PUT', '/settings/model', { ...input, apiKey: undefined })).status).toBe(
      400,
    );
    expect((await send('PUT', '/settings/model', input, 'text/plain')).status).toBe(415);
  });

  it('refuses a foreign Host', async () => {
    const app = createApp({
      store: new BroadcastingStore(new InMemoryEventStore()),
      runs: {} as RunStarter,
      approvals: new ApprovalBroker(),
      models: manager(),
    });
    const res = await app.request('/settings/model', { headers: { host: 'evil.com' } });
    expect(res.status).toBe(403);
  });
});
