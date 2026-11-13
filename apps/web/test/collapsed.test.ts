import { describe, expect, it } from 'vitest';

import { parseCollapsed } from '@/lib/collapsed';

describe('parseCollapsed', () => {
  it('reads a list of folded groups', () => {
    expect(parseCollapsed('["/w/a","/w/b"]')).toEqual(['/w/a', '/w/b']);
  });

  it('treats missing, damaged or wrongly shaped values as nothing folded', () => {
    expect(parseCollapsed(null)).toEqual([]);
    expect(parseCollapsed('{nope')).toEqual([]);
    expect(parseCollapsed('{"a":1}')).toEqual([]);
  });

  it('drops entries that are not strings', () => {
    expect(parseCollapsed('["/w/a",3,null]')).toEqual(['/w/a']);
  });
});
