import { useCallback, useEffect, useState } from 'react';

import { fetchModels, type ModelList } from '@/api';

const EMPTY: ModelList = { models: [], defaultId: null };

/** The saved models and which one is the default. `adopt` takes a list a change request returned. */
export function useModels() {
  const [list, setList] = useState<ModelList>(EMPTY);
  const [failed, setFailed] = useState(false);

  const reload = useCallback(
    () =>
      fetchModels().then(
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
