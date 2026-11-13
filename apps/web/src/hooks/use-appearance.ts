import { useEffect, useState } from 'react';

import { APPEARANCE_KEY, cssVars, parseAppearance, type Appearance } from '@/lib/appearance';

/** Font size and content width of the conversation. Applied as CSS variables and remembered. */
export function useAppearance() {
  const [appearance, setAppearance] = useState<Appearance>(() => {
    try {
      return parseAppearance(localStorage.getItem(APPEARANCE_KEY));
    } catch {
      return parseAppearance(null);
    }
  });

  useEffect(() => {
    for (const [name, value] of Object.entries(cssVars(appearance))) {
      document.documentElement.style.setProperty(name, value);
    }
    try {
      localStorage.setItem(APPEARANCE_KEY, JSON.stringify(appearance));
    } catch {
      // Private mode can refuse storage; the choice then lasts until the page is closed.
    }
  }, [appearance]);

  return { appearance, setAppearance };
}
