import { useCallback, useEffect, useState } from 'react';

import { fetchSessions, type SessionSummary } from '@/api';

/**
 * The session list. It is fetched again whenever `trigger` changes (a run started or ended) and
 * when the window regains focus, so it stays current without polling.
 */
export function useSessions(trigger: string) {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    fetchSessions().then(
      (list) => {
        setSessions(list);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);

  useEffect(refresh, [refresh, trigger]);

  useEffect(() => {
    window.addEventListener('focus', refresh);
    return () => window.removeEventListener('focus', refresh);
  }, [refresh]);

  return { sessions, failed, refresh };
}
