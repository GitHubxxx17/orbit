import { describe, expect, it } from 'vitest';

import { contextUse } from '@/lib/context-use';

describe('contextUse', () => {
  it('reports the share of the window the newest request used', () => {
    const use = contextUse(58_900, 100_000);
    expect(use?.percent).toBe(59);
    expect(use?.tone).toBe('normal');
    expect(use?.detail).toContain('已用 58.9k');
    expect(use?.detail).toContain('剩余 41.1k');
  });

  it('warns from the compaction point and again when nearly full', () => {
    expect(contextUse(70_000, 100_000)?.tone).toBe('high');
    expect(contextUse(95_000, 100_000)?.tone).toBe('full');
  });

  it('is unknown, not 0%, when the window or the usage is not known', () => {
    expect(contextUse(null, 100_000)).toBeNull();
    expect(contextUse(0, 100_000)).toBeNull();
    expect(contextUse(5_000, null)).toBeNull();
    expect(contextUse(5_000, undefined)).toBeNull();
  });

  it('does not report a negative amount free when the request is bigger than the window', () => {
    expect(contextUse(120_000, 100_000)?.detail).toContain('剩余 0');
  });
});
