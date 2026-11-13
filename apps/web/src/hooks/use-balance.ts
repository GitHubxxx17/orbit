import { useCallback, useEffect, useState } from 'react';

import { fetchBalance, type ModelBalance } from '@/api';

/**
 * The provider's account balance for the model in use. Asked again whenever `trigger` changes (a
 * run ended, the model changed), since a run spends money. `enabled` is false when no real model
 * is in use, so the demo never makes a request. The server reuses answers for a short while, so
 * asking often is cheap.
 */
export function useBalance(trigger: string, enabled: boolean, modelId?: string) {
  // Remember whose balance it is, so a number is never shown against another model.
  const [fetched, setFetched] = useState<{
    modelId: string | undefined;
    value: ModelBalance;
  } | null>(null);
  const [loading, setLoading] = useState(false);

  // Manual refresh shows a spinner; the automatic one below stays quiet.
  const refresh = useCallback(
    async (force = false) => {
      if (!enabled) return;
      setLoading(true);
      try {
        setFetched({ modelId, value: await fetchBalance(modelId, force) });
      } catch {
        // A failed lookup keeps the last number on screen rather than blanking it.
      } finally {
        setLoading(false);
      }
    },
    [enabled, modelId],
  );

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetchBalance(modelId, false).then(
      (value) => {
        if (!cancelled) setFetched({ modelId, value });
      },
      () => {
        // A failed lookup keeps the last number on screen rather than blanking it.
      },
    );
    return () => {
      cancelled = true;
    };
  }, [enabled, trigger, modelId]);

  // Derived rather than reset in the effect: with no real model there is nothing to show.
  const balance = enabled && fetched && fetched.modelId === modelId ? fetched.value : null;
  return { balance, loading, refresh };
}
