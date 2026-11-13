import { describe, expect, it } from 'vitest';

import { providerHint } from '../src/provider-error.js';

describe('providerHint', () => {
  it('explains a rate limit', () => {
    expect(providerHint('model error: LLM request failed with status 429: {}')).toContain(
      '稍后重试',
    );
  });

  it('says nothing for other errors, and does not match a longer status number', () => {
    expect(providerHint('LLM request failed with status 401: bad key')).toBeNull();
    expect(providerHint('LLM request failed with status 4290: odd')).toBeNull();
    expect(providerHint('fetch failed (ENOTFOUND)')).toBeNull();
  });
});
