import { describe, expect, it } from 'vitest';

import { cssVars, DEFAULT_APPEARANCE, parseAppearance } from '@/lib/appearance';

describe('parseAppearance', () => {
  it('uses the defaults when nothing is stored or the value is damaged', () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance('{nope')).toEqual(DEFAULT_APPEARANCE);
    expect(parseAppearance('"large"')).toEqual(DEFAULT_APPEARANCE);
  });

  it('keeps the valid fields and replaces only the unknown ones', () => {
    expect(parseAppearance(JSON.stringify({ fontSize: 'large', width: 'huge' }))).toEqual({
      fontSize: 'large',
      width: 'medium',
    });
  });
});

describe('cssVars', () => {
  it('maps the default choice to the sizes the app always had', () => {
    expect(cssVars(DEFAULT_APPEARANCE)).toEqual({ '--msg-size': '15px', '--content-max': '48rem' });
  });

  it('gives each choice its own value', () => {
    const small = cssVars({ fontSize: 'small', width: 'narrow' });
    const large = cssVars({ fontSize: 'large', width: 'wide' });
    expect(small['--msg-size']).not.toBe(large['--msg-size']);
    expect(small['--content-max']).not.toBe(large['--content-max']);
  });
});
