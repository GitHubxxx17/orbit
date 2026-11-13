import { EARLY_STOP_PREFIX } from '@orbit/protocol';

import { duration, formatTokens } from '@/lib/format';
import { cacheShare, type RunView } from '@/state/timeline';

/** The model's name for the line under an answer: the one the run used, else the current default. */
export function modelLabel(view: RunView, liveModel: string | null): string {
  if (view.agentId === 'orbit-demo') return '演示模型';
  const model = view.model ?? liveModel ?? '真实模型';
  return view.agentName ? `${view.agentName} · ${model}` : model;
}

/**
 * The small line under a turn: which model, how long, how many tokens. Shown for a run that
 * finished, and for one Orbit ended early after taking an answer (it still cost something).
 * Tokens come from what the provider reported: when it reported nothing the line says so, and
 * never shows 0. The demo model reports nothing by design, so it says nothing.
 */
export function turnFooter(view: RunView, liveModel: string | null): string | null {
  const ended =
    view.status === 'completed' ||
    (view.status === 'failed' && view.failReason?.startsWith(EARLY_STOP_PREFIX) === true);
  if (!ended || view.startedAt === null || view.endedAt === null) return null;

  const parts = [modelLabel(view, liveModel), `用时 ${duration(view.endedAt - view.startedAt)}`];
  if (view.usage) {
    parts.push(
      `输入 ${formatTokens(view.usage.promptTokens)} · 输出 ${formatTokens(view.usage.completionTokens)} token`,
    );
    const share = cacheShare(view.usage);
    if (share !== null) parts.push(`缓存命中 ${share}%`);
    if (view.usage.calls > 1) parts.push(`${view.usage.calls} 次模型调用`);
  } else if (view.agentId !== 'orbit-demo') {
    parts.push('用量未知');
  }
  return parts.join(' · ');
}
