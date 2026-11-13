import { useCallback, useState } from 'react';

import { COLLAPSED_KEY, parseCollapsed } from '@/lib/collapsed';

/** Which workspace groups in the session list are folded, remembered in this browser. */
export function useCollapsed() {
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => {
    try {
      return new Set(parseCollapsed(localStorage.getItem(COLLAPSED_KEY)));
    } catch {
      return new Set();
    }
  });

  const toggle = useCallback((key: string) => {
    setCollapsed((current) => {
      const next = new Set(current);
      if (!next.delete(key)) next.add(key);
      try {
        localStorage.setItem(COLLAPSED_KEY, JSON.stringify([...next]));
      } catch {
        // Private mode can refuse storage; the fold then lasts until the page is closed.
      }
      return next;
    });
  }, []);

  return { collapsed, toggle };
}
