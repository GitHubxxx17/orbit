import type { LlmConfig } from '@orbit/core';
import { z } from 'zod';

import type { ModelBalance } from '@orbit/protocol';

/**
 * Asking the provider how much money is left. Each provider has its own interface (or none), so
 * this is a small table of the ones we know. The request goes to the same host the chat already
 * uses, with the same key; nothing new is exposed. Only an exact host match is trusted.
 */

const DeepSeekBalance = z.object({
  is_available: z.boolean(),
  balance_infos: z.array(
    z.object({
      currency: z.string(),
      total_balance: z.string(),
      granted_balance: z.string(),
      topped_up_balance: z.string(),
    }),
  ),
});

const TIMEOUT_MS = 10_000;

/** Which providers have a balance interface, decided by the exact host of the base URL. */
export function balanceProvider(baseUrl: string): 'deepseek' | null {
  try {
    return new URL(baseUrl).hostname === 'api.deepseek.com' ? 'deepseek' : null;
  } catch {
    return null;
  }
}

const result = (over: Partial<ModelBalance>, now: number): ModelBalance => ({
  supported: true,
  available: null,
  balances: [],
  message: null,
  checkedAt: now,
  ...over,
});

/** Look up the balance. Every failure becomes a message; the key never appears in one. */
export async function fetchBalance(
  config: LlmConfig,
  options: { fetch?: typeof fetch; now?: () => number } = {},
): Promise<ModelBalance> {
  const now = (options.now ?? Date.now)();
  if (balanceProvider(config.baseUrl) !== 'deepseek') {
    return result(
      { supported: false, message: '这个服务商没有提供可查询余额的接口，或星轨还没有支持它' },
      now,
    );
  }

  const fetchFn = options.fetch ?? fetch;
  const redact = (text: string) => text.replaceAll(config.apiKey, '[redacted]');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetchFn(`${new URL(config.baseUrl).origin}/user/balance`, {
      headers: { authorization: `Bearer ${config.apiKey}`, accept: 'application/json' },
      signal: controller.signal,
    });
    if (res.status === 401 || res.status === 403) {
      return result({ message: 'API Key 无效或没有权限，查不了余额' }, now);
    }
    if (!res.ok) return result({ message: `查询余额失败（HTTP ${res.status}）` }, now);

    const parsed = DeepSeekBalance.safeParse(await res.json());
    if (!parsed.success) return result({ message: '查询余额失败：返回的内容看不懂' }, now);
    return result(
      {
        available: parsed.data.is_available,
        balances: parsed.data.balance_infos.map((line) => ({
          currency: line.currency,
          total: line.total_balance,
          granted: line.granted_balance,
          toppedUp: line.topped_up_balance,
        })),
      },
      now,
    );
  } catch (error) {
    const timedOut = controller.signal.aborted;
    // Node's fetch hides the real reason ("fetch failed") in `cause`, e.g. a certificate error.
    const cause =
      error instanceof Error ? (error.cause as { code?: unknown } | undefined) : undefined;
    const detail =
      (error instanceof Error ? error.message : String(error)) +
      (typeof cause?.code === 'string' ? ` (${cause.code})` : '');
    return result({ message: redact(timedOut ? '查询余额超时' : `查询余额失败：${detail}`) }, now);
  } finally {
    clearTimeout(timer);
  }
}
