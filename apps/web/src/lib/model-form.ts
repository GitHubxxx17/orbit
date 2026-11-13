/** Base-URL shortcuts. Model names are deliberately not prefilled: providers rename them often. */
export const BASE_URL_PRESETS = [
  { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com' },
  { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1' },
] as const;

export interface ModelFormValues {
  /** A name for the picker; empty means the model name is used. */
  label: string;
  baseUrl: string;
  model: string;
  apiKey: string;
  /** The context window as typed: 128000, 128k or 1m; empty when not known. */
  contextWindow: string;
}

const WINDOW_MIN = 1_000;
const WINDOW_MAX = 10_000_000;

/**
 * Read a context window typed by a person. Empty is "not known" (null); 128k and 1m are what
 * provider documents say; anything else that is not a whole number in range is invalid (undefined).
 */
export function parseWindow(text: string): number | null | undefined {
  const trimmed = text.trim().toLowerCase().replaceAll(',', '');
  if (trimmed === '') return null;
  const match = /^(\d+)([km]?)$/.exec(trimmed);
  if (!match) return undefined;
  const scale = match[2] === 'k' ? 1_000 : match[2] === 'm' ? 1_000_000 : 1;
  const value = Number(match[1]) * scale;
  return value >= WINDOW_MIN && value <= WINDOW_MAX ? value : undefined;
}

/**
 * Whether the form can be sent. A key may be left empty only when one is already in use, which
 * means "keep it".
 */
export function modelFormProblem(values: ModelFormValues, hasKey: boolean): string | null {
  if (values.baseUrl.trim() === '') return '请填写接口地址';
  if (values.model.trim() === '') return '请填写模型名称';
  if (values.apiKey.trim() === '' && !hasKey) return '请填写 API Key';
  if (parseWindow(values.contextWindow) === undefined) {
    return '上下文窗口请填 1000 到 1000 万之间的整数，可以写成 128k 或 1m';
  }
  return null;
}

/** The request body: an empty key field is left out so the server keeps the stored one. */
export function modelFormInput(values: ModelFormValues) {
  const apiKey = values.apiKey.trim();
  const label = values.label.trim();
  return {
    ...(label === '' ? {} : { label }),
    baseUrl: values.baseUrl.trim(),
    model: values.model.trim(),
    ...(apiKey === '' ? {} : { apiKey }),
    // Empty clears the stored value.
    contextWindow: parseWindow(values.contextWindow) ?? null,
  };
}
