import {
  checkReport,
  REPORT_TOOL,
  ReportArgs,
  tally,
  type CallFact,
  type CallOutcome,
  type ClaimCheck,
  type ReportTally,
} from '@orbit/protocol';

import type { ChatItem, RunView, ToolCard, ToolStatus } from '@/state/timeline';

/**
 * The report the agent made at the end of a run, with each claim checked against what really
 * happened. The check is the shared rule from `@orbit/protocol`, applied to the run's tool cards,
 * so the screen and the agent's own feedback can never disagree.
 */
export interface ReportView {
  callId: string;
  checks: ClaimCheck[];
  tally: ReportTally;
}

const OUTCOME: Record<ToolStatus, CallOutcome> = {
  done: 'ok',
  failed: 'failed',
  denied: 'denied',
  pending: 'unfinished',
  awaiting: 'unfinished',
  running: 'unfinished',
};

function factsOf(tools: Record<string, ToolCard>): Record<string, CallFact> {
  return Object.fromEntries(
    Object.values(tools).map((card) => [
      card.callId,
      { tool: card.tool, outcome: OUTCOME[card.status], resultSeq: card.resultSeq ?? null },
    ]),
  );
}

/**
 * The newest report the agent made, once it has been recorded. An earlier report is replaced by a
 * later one: the agent is told what was unsupported and may report again. A report call whose
 * arguments do not match the schema never ran, so there is nothing to show.
 */
export function reportOf(view: RunView): ReportView | null {
  const reports = view.items.flatMap((item) => {
    if (item.kind !== 'tool') return [];
    const card = view.tools[item.callId];
    return card?.tool === REPORT_TOOL && card.status === 'done' ? [card] : [];
  });
  const card = reports.at(-1);
  if (!card) return null;
  const args = ReportArgs.safeParse(card.args);
  if (!args.success) return null;
  const checks = checkReport(args.data, factsOf(view.tools), card.callId);
  return { callId: card.callId, checks, tally: tally(checks) };
}

/** Items to show in the process group: the report has its own card, so it is left out. */
export function withoutReport(items: readonly ChatItem[], tools: Record<string, ToolCard>) {
  return items.filter((item) => item.kind !== 'tool' || tools[item.callId]?.tool !== REPORT_TOOL);
}

/**
 * Why a finished run that used tools has no report to show, or null when nothing is missing.
 * `missing`: the agent never called report. `failed`: it called it but the call did not go
 * through (for example malformed arguments). A run that only chatted needs no report.
 */
export function missingReport(view: RunView): 'missing' | 'failed' | null {
  if (view.status !== 'completed') return null;
  const cards = Object.values(view.tools);
  if (!cards.some((card) => card.tool !== REPORT_TOOL)) return null;
  if (reportOf(view)) return null;
  return cards.some((card) => card.tool === REPORT_TOOL) ? 'failed' : 'missing';
}
