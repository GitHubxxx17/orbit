import { useCallback, useEffect, useState } from 'react';

import { isDark, nextTheme, parseTheme, THEME_KEY, type Theme } from '@/lib/theme';

const query = '(prefers-color-scheme: dark)';

function apply(theme: Theme): void {
  document.documentElement.classList.toggle('dark', isDark(theme, matchMedia(query).matches));
}

/** The colour theme: light, dark, or follow the system. The choice is remembered. */
export function useTheme() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      return parseTheme(localStorage.getItem(THEME_KEY));
    } catch {
      return 'system';
    }
  });

  useEffect(() => {
    apply(theme);
    try {
      localStorage.setItem(THEME_KEY, theme);
    } catch {
      // Private mode can refuse storage; the choice then lasts until the page is closed.
    }
    if (theme !== 'system') return;
    // While following the system, react when the system switches.
    const media = matchMedia(query);
    const onChange = () => apply('system');
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, [theme]);

  const cycle = useCallback(() => setTheme((current) => nextTheme(current)), []);
  return { theme, cycle };
}
