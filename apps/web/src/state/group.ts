import type { ChatItem, RunStatus, ToolCard } from '@/state/timeline';

type TextItem = Extract<ChatItem, { kind: 'text' }>;

export type Layout =
  /** No tools were used: just show the text. */
  | { grouped: false; items: ChatItem[] }
  /** Steps (narration and tool calls) go in a collapsible group; the answer stays outside it. */
  | { grouped: true; steps: ChatItem[]; answer: TextItem | null };

/**
 * Decide what belongs in the "process" group. While a run is going, everything is process. Once it
 * has ended, a final text block that follows the tool calls is the answer and stays visible.
 */
export function layoutItems(items: readonly ChatItem[], status: RunStatus): Layout {
  if (!items.some((item) => item.kind === 'tool')) return { grouped: false, items: [...items] };

  const last = items.at(-1);
  if (status !== 'running' && last?.kind === 'text') {
    return { grouped: true, steps: items.slice(0, -1), answer: last };
  }
  return { grouped: true, steps: [...items], answer: null };
}

export interface StepSummary {
  total: number;
  done: number;
  failed: number;
  denied: number;
  active: number;
}

export function summarizeSteps(
  steps: readonly ChatItem[],
  tools: Record<string, ToolCard>,
): StepSummary {
  const summary: StepSummary = { total: 0, done: 0, failed: 0, denied: 0, active: 0 };
  for (const item of steps) {
    if (item.kind !== 'tool') continue;
    const card = tools[item.callId];
    if (!card) continue;
    summary.total += 1;
    if (card.status === 'done') summary.done += 1;
    else if (card.status === 'failed') summary.failed += 1;
    else if (card.status === 'denied') summary.denied += 1;
    else summary.active += 1;
  }
  return summary;
}

export function summaryText(summary: StepSummary, status: RunStatus): string {
  const parts = [`${summary.total} 步`];
  if (summary.failed > 0) parts.push(`${summary.failed} 失败`);
  if (summary.denied > 0) parts.push(`${summary.denied} 被拒绝`);
  const head = status === 'running' ? '处理中' : '已处理';
  return `${head} · ${parts.join(' · ')}`;
}
