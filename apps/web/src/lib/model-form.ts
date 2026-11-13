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
}

/**
 * Whether the form can be sent. A key may be left empty only when one is already in use, which
 * means "keep it".
 */
export function modelFormProblem(values: ModelFormValues, hasKey: boolean): string | null {
  if (values.baseUrl.trim() === '') return '请填写接口地址';
  if (values.model.trim() === '') return '请填写模型名称';
  if (values.apiKey.trim() === '' && !hasKey) return '请填写 API Key';
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
  };
}
