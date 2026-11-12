import { createOpenAICompatibleClient, type LlmClient, type LlmConfig } from '@orbit/core';
import type { ModelInput, ModelStatus, ModelTestResult } from '@orbit/protocol';

import type { SettingsStore } from './settings.js';

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
}

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

/**
 * Holds the model the server talks to. Saving swaps it in place, so runs started afterwards use
 * the new settings without a restart; a run already going keeps the client it began with.
 */
export class ModelManager {
  private active: { config: LlmConfig; source: 'settings' | 'env' } | undefined;
  private client: LiveModel | undefined;

  constructor(private readonly options: ModelManagerOptions) {
    this.reload();
  }

  private reload(): void {
    const stored = this.options.settings.readModel();
    if (stored) this.active = { config: stored, source: 'settings' };
    else if (this.options.env) this.active = { config: this.options.env, source: 'env' };
    else this.active = undefined;
    this.client = this.active
      ? { llm: this.build(this.active.config), name: this.active.config.model }
      : undefined;
  }

  private build(config: LlmConfig): LlmClient {
    return createOpenAICompatibleClient({
      ...config,
      ...(this.options.fetch ? { fetch: this.options.fetch } : {}),
    });
  }

  current(): LiveModel | undefined {
    return this.client;
  }

  status(): ModelStatus {
    if (!this.active) {
      return { configured: false, source: 'none', baseUrl: null, model: null, apiKeyHint: null };
    }
    const { config, source } = this.active;
    return {
      configured: true,
      source,
      baseUrl: config.baseUrl,
      model: config.model,
      apiKeyHint: hintOf(config.apiKey),
    };
  }

  /** Fill in what the user left out: a missing key means "keep the one in use". */
  private resolve(input: ModelInput): LlmConfig {
    const apiKey = input.apiKey ?? this.active?.config.apiKey;
    if (!apiKey) throw new SettingsError('请填写 API Key');
    return { baseUrl: normalizeBaseUrl(input.baseUrl), apiKey, model: input.model.trim() };
  }

  save(input: ModelInput): ModelStatus {
    this.options.settings.writeModel(this.resolve(input));
    this.reload();
    return this.status();
  }

  /** Forget the saved model; the environment fallback, if any, applies again. */
  clear(): ModelStatus {
    this.options.settings.writeModel(undefined);
    this.reload();
    return this.status();
  }

  /** Send a tiny request with the given settings (saved or not) and report how it went. */
  async test(input: ModelInput): Promise<ModelTestResult> {
    const config = this.resolve(input);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.testTimeoutMs ?? 15_000);
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
      const text =
        (error instanceof Error ? error.message : String(error)) +
        (typeof cause?.code === 'string' ? ` (${cause.code})` : '');
      return {
        ok: false,
        message: (timedOut ? '请求超时' : text).replaceAll(config.apiKey, '[redacted]'),
        latencyMs: null,
      };
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
}
