/** How the conversation looks. Kept in this browser only: it is a taste, not shared state. */
export const FONT_SIZES = ['small', 'medium', 'large'] as const;
export const WIDTHS = ['narrow', 'medium', 'wide'] as const;

export type FontSize = (typeof FONT_SIZES)[number];
export type Width = (typeof WIDTHS)[number];

export interface Appearance {
  fontSize: FontSize;
  width: Width;
}

export const APPEARANCE_KEY = 'orbit-appearance';
export const DEFAULT_APPEARANCE: Appearance = { fontSize: 'medium', width: 'medium' };

export const FONT_LABEL: Record<FontSize, string> = { small: '小', medium: '中', large: '大' };
export const WIDTH_LABEL: Record<Width, string> = { narrow: '窄', medium: '中', wide: '宽' };

/** The CSS values each choice stands for. Medium matches what the app looked like before. */
const FONT_PX: Record<FontSize, string> = { small: '14px', medium: '15px', large: '17px' };
const WIDTH_REM: Record<Width, string> = { narrow: '40rem', medium: '48rem', wide: '64rem' };

export function cssVars(appearance: Appearance): Record<string, string> {
  return {
    '--msg-size': FONT_PX[appearance.fontSize],
    '--content-max': WIDTH_REM[appearance.width],
  };
}

const oneOf = <T extends string>(options: readonly T[], value: unknown, fallback: T): T =>
  options.find((option) => option === value) ?? fallback;

/** Read what was stored; anything missing or unknown falls back field by field. */
export function parseAppearance(raw: string | null): Appearance {
  let data: unknown = null;
  try {
    data = raw === null ? null : JSON.parse(raw);
  } catch {
    // A damaged value is the same as no value.
  }
  const record = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  return {
    fontSize: oneOf(FONT_SIZES, record.fontSize, DEFAULT_APPEARANCE.fontSize),
    width: oneOf(WIDTHS, record.width, DEFAULT_APPEARANCE.width),
  };
}
