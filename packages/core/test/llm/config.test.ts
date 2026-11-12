import { describe, expect, it } from 'vitest';
import { loadLlmConfig } from '../../src/llm/config.js';

describe('loadLlmConfig', () => {
  it('reads a valid environment', () => {
    expect(
      loadLlmConfig({
        ORBIT_LLM_BASE_URL: 'https://example.test/v1',
        ORBIT_LLM_API_KEY: 'k',
        ORBIT_LLM_MODEL: 'm',
      }),
    ).toEqual({ baseUrl: 'https://example.test/v1', apiKey: 'k', model: 'm' });
  });

  it('names the missing variables without leaking any value', () => {
    expect(() =>
      loadLlmConfig({ ORBIT_LLM_BASE_URL: 'not a url', ORBIT_LLM_API_KEY: 'super-secret' }),
    ).toThrowError(/ORBIT_LLM_BASE_URL.*ORBIT_LLM_MODEL|ORBIT_LLM_MODEL.*ORBIT_LLM_BASE_URL/);
    try {
      loadLlmConfig({ ORBIT_LLM_BASE_URL: 'not a url', ORBIT_LLM_API_KEY: 'super-secret' });
    } catch (error) {
      expect(String(error)).not.toContain('super-secret');
    }
  });
});
