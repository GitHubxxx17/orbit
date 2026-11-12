import { describe, expect, it } from 'vitest';

import { isDark, nextTheme, parseTheme } from '@/lib/theme';

describe('theme', () => {
  it('reads a saved choice and ignores anything unexpected', () => {
    expect(parseTheme('dark')).toBe('dark');
    expect(parseTheme('light')).toBe('light');
    expect(parseTheme('system')).toBe('system');
    expect(parseTheme('purple')).toBe('system');
    expect(parseTheme(null)).toBe('system');
  });

  it('is dark when chosen, or when following a dark system', () => {
    expect(isDark('dark', false)).toBe(true);
    expect(isDark('light', true)).toBe(false);
    expect(isDark('system', true)).toBe(true);
    expect(isDark('system', false)).toBe(false);
  });

  it('cycles system, light, dark and back', () => {
    expect(nextTheme('system')).toBe('light');
    expect(nextTheme('light')).toBe('dark');
    expect(nextTheme('dark')).toBe('system');
  });
});
