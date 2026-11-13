/**
 * A plain-language hint for a model provider's error text, or null when there is nothing to add.
 * The original text is always kept next to it: the hint only helps the reader decide what to do.
 */
export function providerHint(text: string): string | null {
  if (/\bstatus 429\b/.test(text)) {
    return '服务商限流或该模型访问量过大，请稍后重试，或换一个模型。';
  }
  return null;
}
