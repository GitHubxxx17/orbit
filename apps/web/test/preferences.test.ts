import { describe, expect, it } from 'vitest';

import { DEFAULT_PREFERENCES, parsePreferences } from '@/lib/preferences';

describe('parsePreferences', () => {
  it('uses the defaults when nothing is stored or the value is damaged', () => {
    expect(parsePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('{nope')).toEqual(DEFAULT_PREFERENCES);
    expect(parsePreferences('[]')).toEqual(DEFAULT_PREFERENCES);
  });

  it('keeps valid fields and replaces only the wrong ones', () => {
    const stored = JSON.stringify({
      showTimestamps: true,
      expandTools: 'yes',
      plainDiff: true,
      defaultApproval: 'readonly',
    });
    expect(parsePreferences(stored)).toEqual({
      showTimestamps: true,
      expandTools: false,
      plainDiff: true,
      defaultApproval: 'readonly',
    });
  });

  it('never accepts an approval mode it does not know', () => {
    expect(parsePreferences(JSON.stringify({ defaultApproval: 'always' })).defaultApproval).toBe(
      'ask',
    );
  });
});
