import { describe, expect, it } from 'vitest';

import { cachedTokensOf } from '../../src/llm/cache-usage.js';

describe('cachedTokensOf', () => {
  it('reads DeepSeek’s hit count', () => {
    expect(cachedTokensOf({ prompt_cache_hit_tokens: 128, prompt_cache_miss_tokens: 40 })).toBe(
      128,
    );
  });

  it('reads the OpenAI-style nested count', () => {
    expect(cachedTokensOf({ prompt_tokens_details: { cached_tokens: 1024 } })).toBe(1024);
  });

  it('keeps a real zero', () => {
    expect(cachedTokensOf({ prompt_cache_hit_tokens: 0 })).toBe(0);
    expect(cachedTokensOf({ prompt_tokens_details: { cached_tokens: 0 } })).toBe(0);
  });

  it('is unknown, not zero, when the provider says nothing or says something odd', () => {
    expect(cachedTokensOf({ prompt_tokens: 5 })).toBeNull();
    expect(cachedTokensOf(null)).toBeNull();
    expect(cachedTokensOf('x')).toBeNull();
    expect(cachedTokensOf({ prompt_cache_hit_tokens: -1 })).toBeNull();
    expect(cachedTokensOf({ prompt_cache_hit_tokens: 1.5 })).toBeNull();
    expect(cachedTokensOf({ prompt_tokens_details: { cached_tokens: 'many' } })).toBeNull();
  });

  it('prefers DeepSeek’s field when both are present', () => {
    expect(
      cachedTokensOf({ prompt_cache_hit_tokens: 10, prompt_tokens_details: { cached_tokens: 99 } }),
    ).toBe(10);
  });
});
