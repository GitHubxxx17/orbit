export type Theme = 'system' | 'light' | 'dark';

export const THEME_KEY = 'orbit-theme';
const ORDER: Theme[] = ['system', 'light', 'dark'];

export function parseTheme(value: string | null): Theme {
  return value === 'light' || value === 'dark' || value === 'system' ? value : 'system';
}

/** Whether the dark palette applies for a choice, given the system's preference. */
export function isDark(theme: Theme, systemPrefersDark: boolean): boolean {
  return theme === 'dark' || (theme === 'system' && systemPrefersDark);
}

/** The choice that comes after this one when the user presses the toggle. */
export function nextTheme(theme: Theme): Theme {
  return ORDER[(ORDER.indexOf(theme) + 1) % ORDER.length] ?? 'system';
}
