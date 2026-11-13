import { useCallback, useEffect, useState } from 'react';

import { fetchBalance, type ModelBalance } from '@/api';

/**
 * The provider's account balance for the model in use. Asked again whenever `trigger` changes (a
 * run ended, the model changed), since a run spends money. `enabled` is false when no real model
 * is in use, so the demo never makes a request. The server reuses answers for a short while, so
 * asking often is cheap.
 */
export function useBalance(trigger: string, enabled: boolean) {
  const [fetched, setFetched] = useState<ModelBalance | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async (force: boolean) => {
    try {
      setFetched(await fetchBalance(force));
    } catch {
      // A failed lookup keeps the last number on screen rather than blanking it.
    }
  }, []);

  // Manual refresh shows a spinner; the automatic one stays quiet.
  const refresh = useCallback(
    async (force = false) => {
      if (!enabled) return;
      setLoading(true);
      await load(force);
      setLoading(false);
    },
    [enabled, load],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchBalance(false).then(
      (next) => {
        if (!cancelled) setFetched(next);
      },
      () => {
        // A failed lookup keeps the last number on screen rather than blanking it.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, trigger]);

  // Derived rather than reset in the effect: with no real model there is nothing to show.
  return { balance: enabled ? fetched : null, loading, refresh };
}
