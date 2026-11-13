import { useCallback, useEffect, useState } from 'react';

import { fetchWorkspaces, type WorkspaceList } from '@/api';

const EMPTY: WorkspaceList = { workspaces: [], defaultId: '', errors: [] };

/** The workspaces the server has registered, the default first. Read-only. */
export function useWorkspaces() {
  const [list, setList] = useState<WorkspaceList>(EMPTY);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(
    () =>
      fetchWorkspaces().then(
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
