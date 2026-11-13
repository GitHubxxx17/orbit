import { createContext, useContext, useEffect, useState } from 'react';

import {
  DEFAULT_PREFERENCES,
  parsePreferences,
  PREFERENCES_KEY,
  type Preferences,
} from '@/lib/preferences';

/** The chat preferences, remembered in this browser. */
export function usePreferencesState() {
  const [preferences, setPreferences] = useState<Preferences>(() => {
    try {
      return parsePreferences(localStorage.getItem(PREFERENCES_KEY));
    } catch {
      return DEFAULT_PREFERENCES;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(PREFERENCES_KEY, JSON.stringify(preferences));
    } catch {
      // Private mode can refuse storage; the choice then lasts until the page is closed.
    }
  }, [preferences]);

  return { preferences, setPreferences };
}

/** Lets deep components (tool steps, diffs) read the preferences without passing props down. */
export const PreferencesContext = createContext<Preferences>(DEFAULT_PREFERENCES);

export const usePreferences = () => useContext(PreferencesContext);
