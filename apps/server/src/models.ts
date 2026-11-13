import { randomUUID } from 'node:crypto';

import { createOpenAICompatibleClient, type LlmClient, type LlmConfig } from '@orbit/core';
import { providerHint } from '@orbit/protocol';
import type {
  ModelBalance,
  ModelInput,
  ModelList,
  ModelTestInput,
  ModelTestResult,
} from '@orbit/protocol';

import { fetchBalance } from './balance.js';
import type { SettingsStore, StoredModel, StoredModels } from './settings.js';

/** A request the user can fix: bad URL, missing key. */
export class SettingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsError';
  }
}

export interface LiveModel {
  llm: LlmClient;
  name: string;
}

export interface ModelManagerOptions {
  settings: SettingsStore;
  /** Fallback from the environment (.env), used while nothing is saved in settings. */
  env?: LlmConfig | undefined;
  fetch?: typeof fetch;
  /** How long a connection test may take. */
  testTimeoutMs?: number;
  /** Injectable clock for the balance cache. */
  now?: () => number;
  /** Injectable id generator for new models. */
  newId?: () => string;
}

/** How long a balance is reused, so a busy screen does not keep asking the provider. */
const BALANCE_TTL_MS = 30_000;
/** The shortest gap even a manual refresh obeys, and how long a failed lookup is remembered. */
const BALANCE_MIN_GAP_MS = 3_000;

/** What a timed-out connection test says: the provider may simply be busy, which is not a setup error. */
const TIMEOUT_MESSAGE = '请求超时：服务商没有及时回应，可能在排队或限流，请稍后重试';

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Check and normalise a base URL. Plain http would send the key in the clear, so only loopback may use it. */
export function normalizeBaseUrl(raw: string): string {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new SettingsError('接口地址不是有效的 URL');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new SettingsError('接口地址只支持 http 或 https');
  }
  if (url.protocol === 'http:' && !LOOPBACK.has(url.hostname)) {
    throw new SettingsError('非本机地址必须使用 https，否则 API Key 会明文传输');
  }
  if (url.username || url.password) throw new SettingsError('接口地址不能包含账号密码');
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

const hintOf = (apiKey: string) => (apiKey.length > 8 ? apiKey.slice(-4) : '****');

/** The id of the model that comes from .env. */
export const ENV_ID = 'env';

interface Entry {
  id: string;
  label: string;
  config: LlmConfig;
  source: 'settings' | 'env';
  live: LiveModel;
}

/**
 * Holds the models the server can talk to. Saving swaps them in place, so runs started afterwards
 * use the new settings without a restart; a run already going keeps the client it began with.
 */
export class ModelManager {
  private entries: Entry[] = [];
  private defaultId: string | null = null;
  private balanceCache = new Map<string, { at: number; value: ModelBalance }>();
  private balanceInFlight = new Map<string, Promise<ModelBalance>>();

  constructor(private readonly options: ModelManagerOptions) {
    this.reload();
  }

  private reload(): void {
    const stored = this.options.settings.read();
    if (stored.models.length > 0) {
      this.entries = stored.models.map((m) =>
        this.entry(
          m.id,
          m.label,
          { baseUrl: m.baseUrl, apiKey: m.apiKey, model: m.model },
          'settings',
        ),
      );
      this.defaultId = stored.defaultId;
    } else if (this.options.env) {
      this.entries = [this.entry(ENV_ID, this.options.env.model, this.options.env, 'env')];
      this.defaultId = ENV_ID;
    } else {
      this.entries = [];
      this.defaultId = null;
    }
    // A different model or key means a different account: forget the old balances.
    this.balanceCache.clear();
  }

  private entry(id: string, label: string, config: LlmConfig, source: Entry['source']): Entry {
    return { id, label, config, source, live: { llm: this.build(config), name: config.model } };
  }

  private build(config: LlmConfig): LlmClient {
    return createOpenAICompatibleClient({
      ...config,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
  }

  private find(id: string | undefined): Entry | undefined {
    const wanted = id ?? this.defaultId;
    return this.entries.find((e) => e.id === wanted);
  }

  /** The model for a run: the one asked for, or the default. Undefined when there is none. */
  current(id?: string): LiveModel | undefined {
    return this.find(id)?.live;
  }

  list(): ModelList {
    return {
      models: this.entries.map((e) => ({
        id: e.id,
        label: e.label,
        baseUrl: e.config.baseUrl,
        model: e.config.model,
        apiKeyHint: hintOf(e.config.apiKey),
        source: e.source,
      })),
      defaultId: this.defaultId,
    };
  }

  private stored(): StoredModels {
    return this.options.settings.read();
  }

  private newId(): string {
    return (this.options.newId ?? randomUUID)();
  }

  /** Add a model (`id` omitted) or change one. A missing key means "keep the one in use". */
  save(id: string | undefined, input: ModelInput): ModelList {
    const stored = this.stored();
    const existing = id === undefined ? undefined : stored.models.find((m) => m.id === id);
    if (id !== undefined && !existing) throw new SettingsError('找不到这个模型');
    const apiKey = input.apiKey ?? existing?.apiKey;
    if (!apiKey) throw new SettingsError('请填写 API Key');
    const model = input.model.trim();
    const saved: StoredModel = {
      id: existing?.id ?? this.newId(),
      label: input.label?.trim() || model,
      baseUrl: normalizeBaseUrl(input.baseUrl),
      apiKey,
      model,
    };
    const models = existing
      ? stored.models.map((m) => (m.id === saved.id ? saved : m))
      : [...stored.models, saved];
    this.options.settings.write({ models, defaultId: stored.defaultId ?? saved.id });
    this.reload();
    return this.list();
  }

  /** Forget a saved model. If it was the default, the first remaining one takes over. */
  remove(id: string): ModelList {
    const stored = this.stored();
    if (!stored.models.some((m) => m.id === id)) throw new SettingsError('找不到这个模型');
    const models = stored.models.filter((m) => m.id !== id);
    const defaultId = stored.defaultId === id ? (models[0]?.id ?? null) : stored.defaultId;
    this.options.settings.write({ models, defaultId });
    this.reload();
    return this.list();
  }

  setDefault(id: string): ModelList {
    const stored = this.stored();
    if (!stored.models.some((m) => m.id === id)) throw new SettingsError('找不到这个模型');
    this.options.settings.write({ models: stored.models, defaultId: id });
    this.reload();
    return this.list();
  }

  /**
   * The account balance at the provider, for one model (the default if none is named). The key
   * stays on the server: the answer holds numbers and a message only. Reused for a short while;
   * `refresh` asks again but not more often than every few seconds. Concurrent asks share one
   * request.
   */
  async balance(id?: string, refresh = false): Promise<ModelBalance> {
    const now = (this.options.now ?? Date.now)();
    const entry = this.find(id);
    if (!entry) {
      return {
        supported: false,
        available: null,
        balances: [],
        message: '还没有配置模型',
        checkedAt: now,
      };
    }
    const cached = this.balanceCache.get(entry.id);
    if (cached) {
      const worked = cached.value.balances.length > 0 || !cached.value.supported;
      const limit = refresh || !worked ? BALANCE_MIN_GAP_MS : BALANCE_TTL_MS;
      if (now - cached.at < limit) return cached.value;
    }
    const running = this.balanceInFlight.get(entry.id);
    if (running) return running;

    const request = fetchBalance(entry.config, {
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
      now: () => now,
    }).then((value) => {
      // Ignore the answer if the models were changed while it was on its way.
      if (this.find(entry.id) === entry) this.balanceCache.set(entry.id, { at: now, value });
      return value;
    });
    this.balanceInFlight.set(entry.id, request);
    try {
      return await request;
    } finally {
      this.balanceInFlight.delete(entry.id);
    }
  }

  /** Send a tiny request with the given settings (saved or not) and report how it went. */
  async test(input: ModelTestInput): Promise<ModelTestResult> {
    const reused = input.id === undefined ? undefined : this.entries.find((e) => e.id === input.id);
    const apiKey = input.apiKey ?? reused?.config.apiKey;
    if (!apiKey) throw new SettingsError('请填写 API Key');
    const config: LlmConfig = {
      baseUrl: normalizeBaseUrl(input.baseUrl),
      apiKey,
      model: input.model.trim(),
    };
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.testTimeoutMs ?? 30_000);
    const started = Date.now();
    try {
      const stream = this.build(config).stream(
        { messages: [{ role: 'user', content: 'ping' }], maxTokens: 8 },
        controller.signal,
      );
      for await (const event of stream) {
        void event;
        break;
      }
      return { ok: true, message: '连接成功', latencyMs: Date.now() - started };
    } catch (error) {
      const timedOut = controller.signal.aborted;
      // Node's fetch hides the real reason ("fetch failed") in `cause`, e.g. ENOTFOUND.
      const cause =
        error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
      const raw =
        (error instanceof Error ? error.message : String(error)) +
        (typeof cause?.code === 'string' ? ` (${cause.code})` : '');
      const hint = providerHint(raw);
      const text = hint ? `${raw}。${hint}` : raw;
      return {
        ok: false,
        message: (timedOut ? TIMEOUT_MESSAGE : text).replaceAll(config.apiKey, '[redacted]'),
        latencyMs: null,
      };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
