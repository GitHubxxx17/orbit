import { formatTokens } from '@/lib/format';

export interface ContextUse {
  /** 0 to 100, rounded; can pass 100 when the window is smaller than the request. */
  percent: number;
  /** For the tooltip: used, free and total. */
  detail: string;
  /** `high` from the point where old tool outputs start being masked. */
  tone: 'normal' | 'high' | 'full';
}

/**
 * How full the model's context window is, from the size of the newest request and the window the
 * user entered. Null when either is unknown: a guess would be a made-up number.
 */
export function contextUse(
  lastPromptTokens: number | null | undefined,
  windowTokens: number | null | undefined,
  compactAt = 0.7,
): ContextUse | null {
  if (!lastPromptTokens || !windowTokens) return null;
  const ratio = lastPromptTokens / windowTokens;
  const free = Math.max(windowTokens - lastPromptTokens, 0);
  return {
    percent: Math.round(ratio * 100),
    detail: `上下文窗口：已用 ${formatTokens(lastPromptTokens)}，剩余 ${formatTokens(free)}，共 ${formatTokens(windowTokens)}（用到 ${Math.round(compactAt * 100)}% 时压缩旧的工具输出）`,
    tone: ratio >= 0.9 ? 'full' : ratio >= compactAt ? 'high' : 'normal',
  };
}
