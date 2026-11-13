/**
 * How many of a request's input tokens the provider served from its prompt cache, read from the
 * `usage` object of a reply. Providers report this differently:
 *
 * - DeepSeek: `prompt_cache_hit_tokens` (with `prompt_cache_miss_tokens` next to it).
 * - OpenAI and compatibles that copy it: `prompt_tokens_details.cached_tokens`.
 *
 * Anything else is unknown, and unknown is `null`, never 0: a provider that does not say is not a
 * provider with no cache hits. Add a provider by adding its field here, with a test.
 */
export function cachedTokensOf(usage: unknown): number | null {
  if (typeof usage !== 'object' || usage === null) return null;
  const record = usage as Record<string, unknown>;

  const deepseek = record['prompt_cache_hit_tokens'];
  if (isCount(deepseek)) return deepseek;

  const details = record['prompt_tokens_details'];
  if (typeof details === 'object' && details !== null) {
    const cached = (details as Record<string, unknown>)['cached_tokens'];
    if (isCount(cached)) return cached;
  }
  return null;
}

const isCount = (value: unknown): value is number =>
  typeof value === 'number' && Number.isInteger(value) && value >= 0;
