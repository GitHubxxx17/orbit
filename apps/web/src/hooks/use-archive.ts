import { useCallback, useEffect, useState } from 'react';

import { fetchArchive, type SessionSummary } from '@/api';

/** The archived conversations. `refresh` after archiving, restoring or deleting one. */
export function useArchive() {
  const [sessions, setSessions] = useState<SessionSummary[]>([]);
  const [failed, setFailed] = useState(false);

  const refresh = useCallback(() => {
    fetchArchive().then(
      (list) => {
        setSessions(list);
        setFailed(false);
      },
      () => setFailed(true),
    );
  }, []);

  useEffect(refresh, [refresh]);

  return { sessions, failed, refresh };
}
