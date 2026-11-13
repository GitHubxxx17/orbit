/** Chat choices kept in this browser. Like the look of the page, they are a taste, not shared state. */
export type DefaultApproval = 'ask' | 'readonly';

export interface Preferences {
  /** Show the time each question was asked. */
  showTimestamps: boolean;
  /** Open every tool call's details at once instead of keeping them folded. */
  expandTools: boolean;
  /** Show diffs as plain text, without the red and green colouring. */
  plainDiff: boolean;
  /** How writes are handled until the user changes it in the input box. */
  defaultApproval: DefaultApproval;
}

export const PREFERENCES_KEY = 'orbit-preferences';

export const DEFAULT_PREFERENCES: Preferences = {
  showTimestamps: false,
  expandTools: false,
  plainDiff: false,
  defaultApproval: 'ask',
};

/** Read what was stored; anything missing or of the wrong type falls back field by field. */
export function parsePreferences(raw: string | null): Preferences {
  let data: unknown = null;
  try {
    data = raw === null ? null : JSON.parse(raw);
  } catch {
    // A damaged value is the same as no value.
  }
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const flag = (key: 'showTimestamps' | 'expandTools' | 'plainDiff') =>
    typeof record[key] === 'boolean' ? record[key] : DEFAULT_PREFERENCES[key];
  return {
    showTimestamps: flag('showTimestamps'),
    expandTools: flag('expandTools'),
    plainDiff: flag('plainDiff'),
    defaultApproval:
      record.defaultApproval === 'ask' || record.defaultApproval === 'readonly'
        ? record.defaultApproval
        : DEFAULT_PREFERENCES.defaultApproval,
  };
}
