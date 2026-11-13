import { useCallback, useEffect, useState } from 'react';

import { fetchAgents, type AgentList } from '@/api';

const EMPTY: AgentList = { agents: [] };

/** The agent profiles, the built-in one first. `adopt` takes a list a change request returned. */
export function useAgents() {
  const [list, setList] = useState<AgentList>(EMPTY);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(
    () =>
      fetchAgents().then(
        (next) => {
          setList(next);
          setFailed(false);
        },
        () => setFailed(true),
      ),
    [],
  );

  useEffect(() => {
    void reload();
  }, [reload]);

  return { list, failed, reload, adopt: setList };
}
