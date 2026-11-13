import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { InMemoryEventStore } from '@orbit/core';
import { ModelBalance } from '@orbit/protocol';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { ApprovalBroker } from '../src/approvals.js';
import { createApp } from '../src/app.js';
import { balanceProvider, fetchBalance } from '../src/balance.js';
import { BroadcastingStore } from '../src/broadcast-store.js';
import { ModelManager } from '../src/models.js';
import type { RunStarter } from '../src/runs.js';
import { SettingsStore } from '../src/settings.js';

const KEY = 'sk-super-secret-1234';
const deepseek = { baseUrl: 'https://api.deepseek.com', apiKey: KEY, model: 'deepseek-flash' };

const reply = {
  is_available: true,
  balance_infos: [
    { currency: 'CNY', total_balance: '2.13', granted_balance: '0.00', topped_up_balance: '2.13' },
  ],
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('balanceProvider', () => {
  it('knows DeepSeek by its exact host and nothing that merely looks like it', () => {
    expect(balanceProvider('https://api.deepseek.com')).toBe('deepseek');
    expect(balanceProvider('https://api.deepseek.com/v1')).toBe('deepseek');
    expect(balanceProvider('https://api.deepseek.com.evil.example')).toBeNull();
    expect(balanceProvider('https://evil.example/api.deepseek.com')).toBeNull();
    expect(balanceProvider('https://openai.com/v1')).toBeNull();
    expect(balanceProvider('not a url')).toBeNull();
  });
});

describe('fetchBalance', () => {
  it('reads the balance with the key, from the provider’s own host', async () => {
    let seen: { url: string; auth: string | null } | undefined;
    const result = await fetchBalance(deepseek, {
      now: () => 42,
      fetch: async (url, init) => {
        seen = {
          url: String(url),
          auth: new Headers(init?.headers).get('authorization'),
        };
        return json(reply);
      },
    });
    expect(seen).toEqual({ url: 'https://api.deepseek.com/user/balance', auth: `Bearer ${KEY}` });
    expect(result).toEqual({
      supported: true,
      available: true,
      balances: [{ currency: 'CNY', total: '2.13', granted: '0.00', toppedUp: '2.13' }],
      message: null,
      checkedAt: 42,
    });
    expect(ModelBalance.safeParse(result).success).toBe(true);
  });

  it('keeps the amounts exactly as the provider wrote them', async () => {
    const result = await fetchBalance(deepseek, {
      fetch: async () =>
        json({
          is_available: true,
          balance_infos: [
            {
              currency: 'USD',
              total_balance: '110.000',
              granted_balance: '10',
              topped_up_balance: '100.000',
            },
          ],
        }),
    });
    expect(result.balances[0]).toMatchObject({ total: '110.000', granted: '10' });
  });

  it('reports an account that cannot make calls', async () => {
    const result = await fetchBalance(deepseek, {
      fetch: async () => json({ is_available: false, balance_infos: [] }),
    });
    expect(result).toMatchObject({ supported: true, available: false, balances: [] });
  });

  it('says a provider without a balance interface is unsupported, and does not call it', async () => {
    let called = false;
    const result = await fetchBalance(
      { ...deepseek, baseUrl: 'https://api.example.com/v1' },
      {
        fetch: async () => {
          called = true;
          return json(reply);
        },
      },
    );
    expect(called).toBe(false);
    expect(result).toMatchObject({ supported: false, balances: [] });
    expect(result.message).toBeTruthy();
  });

  it.each([
    ['a rejected key', json({}, 401), '无效'],
    ['a server error', json({}, 500), 'HTTP 500'],
    ['a reply it cannot read', json({ unexpected: true }), '看不懂'],
  ])('turns %s into a message, never into a zero balance', async (_label, response, text) => {
    const result = await fetchBalance(deepseek, { fetch: async () => response });
    expect(result).toMatchObject({ supported: true, available: null, balances: [] });
    expect(result.message).toContain(text);
  });

  it('shows why a request failed, and never the key', async () => {
    const result = await fetchBalance(deepseek, {
      fetch: async () => {
        throw new TypeError(`fetch failed for ${KEY}`, { cause: { code: 'ENOTFOUND' } });
      },
    });
    expect(result.balances).toEqual([]);
    expect(result.message).toContain('ENOTFOUND');
    expect(result.message).not.toContain(KEY);
    expect(result.message).toContain('[redacted]');
  });
});

describe('ModelManager.balance', () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-balance-'));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  function setup(responses: (() => Response)[] = [() => json(reply)]) {
    let clock = 1_000_000;
    let calls = 0;
    const settings = new SettingsStore(path.join(dir, 'settings.json'));
    settings.writeModel(deepseek);
    const models = new ModelManager({
      settings,
      now: () => clock,
      fetch: async () => {
        const make = responses[Math.min(calls, responses.length - 1)] ?? (() => json(reply));
        calls += 1;
        return make();
      },
    });
    return { models, calls: () => calls, advance: (ms: number) => (clock += ms) };
  }

  it('says so when no model is configured', async () => {
    const models = new ModelManager({ settings: new SettingsStore(path.join(dir, 'none.json')) });
    expect(await models.balance()).toMatchObject({ supported: false, message: '还没有配置模型' });
  });

  it('reuses a good answer for a while, then asks again', async () => {
    const { models, calls, advance } = setup();
    await models.balance();
    advance(10_000);
    await models.balance();
    expect(calls()).toBe(1);
    advance(25_000);
    await models.balance();
    expect(calls()).toBe(2);
  });

  it('lets a manual refresh ask again, but not several times in a few seconds', async () => {
    const { models, calls, advance } = setup();
    await models.balance();
    await models.balance(true);
    expect(calls()).toBe(1);
    advance(4_000);
    await models.balance(true);
    expect(calls()).toBe(2);
  });

  it('retries a failed lookup soon instead of remembering the failure for long', async () => {
    const { models, calls, advance } = setup([() => json({}, 500), () => json(reply)]);
    expect((await models.balance()).balances).toEqual([]);
    advance(4_000);
    expect((await models.balance()).balances).toHaveLength(1);
    expect(calls()).toBe(2);
  });

  it('shares one request between callers that ask at the same moment', async () => {
    const { models, calls } = setup();
    await Promise.all([models.balance(), models.balance(), models.balance()]);
    expect(calls()).toBe(1);
  });

  it('forgets the answer when the model or key changes', async () => {
    const { models, calls } = setup();
    await models.balance();
    models.save({
      baseUrl: 'https://api.deepseek.com',
      model: 'deepseek-flash',
      apiKey: 'sk-other-5678',
    });
    await models.balance();
    expect(calls()).toBe(2);
  });
});

describe('GET /settings/model/balance', () => {
  it('returns numbers and a message, never the key', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orbit-balance-route-'));
    try {
      const settings = new SettingsStore(path.join(dir, 'settings.json'));
      settings.writeModel(deepseek);
      const models = new ModelManager({ settings, fetch: async () => json(reply) });
      const app = createApp({
        store: new BroadcastingStore(new InMemoryEventStore()),
        runs: {} as RunStarter,
        approvals: new ApprovalBroker(),
        models,
      });
      const res = await app.request('/settings/model/balance', { headers: { host: 'localhost' } });
      const text = await res.text();

      expect(res.status).toBe(200);
      expect(text).not.toContain(KEY);
      expect(ModelBalance.parse(JSON.parse(text)).balances[0]?.total).toBe('2.13');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
