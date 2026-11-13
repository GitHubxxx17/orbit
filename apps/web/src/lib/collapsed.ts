export const COLLAPSED_KEY = 'orbit-collapsed-groups';

/** Read the folded groups; anything that is not a list of strings counts as nothing folded. */
export function parseCollapsed(raw: string | null): string[] {
  try {
    const data: unknown = raw === null ? [] : JSON.parse(raw);
    return Array.isArray(data)
      ? data.filter((item): item is string => typeof item === 'string')
      : [];
  } catch {
    return [];
  }
}
