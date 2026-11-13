import { z } from 'zod';

import type { OrbitEvent } from './events.js';

/**
 * Claims and evidence. At the end of its work the agent calls the `report` tool with the
 * conclusions it reached, each listing the tool calls that prove it. Whether a claim has evidence is
 * decided here, by looking at what really happened in the run, never by trusting the model.
 *
 * What this checks: the cited call exists, belongs to this run, finished successfully and happened
 * before the report. What it cannot check: that the cited call actually supports the claim's
 * wording. That needs a judge and is a different problem (see ADR 0007).
 *
 * This lives in the protocol package because the server (to answer the agent) and the web app (to
 * show the result) must apply the same rule, and the rule is a pure function of the events.
 */

export const REPORT_TOOL = 'report';
export const MAX_CLAIMS = 20;
export const MAX_EVIDENCE_PER_CLAIM = 10;

export const Claim = z.object({
  /** One conclusion, in the agent's words. */
  text: z.string().trim().min(1).max(500),
  /** Ids of the tool calls that prove it. Empty means the agent has nothing to back it with. */
  evidence: z.array(z.string().min(1).max(200)).max(MAX_EVIDENCE_PER_CLAIM),
});
export type Claim = z.infer<typeof Claim>;

export const ReportArgs = z.object({
  claims: z.array(Claim).min(1).max(MAX_CLAIMS),
});
export type ReportArgs = z.infer<typeof ReportArgs>;

/** How a tool call ended, as far as evidence is concerned. */
export type CallOutcome = 'ok' | 'failed' | 'denied' | 'unfinished';

export interface CallFact {
  tool: string;
  outcome: CallOutcome;
  /** The seq of its tool.result; null while it has none. */
  resultSeq: number | null;
}

/** What happened to every tool call of a run, from its events. */
export function factsFromEvents(events: readonly OrbitEvent[]): Record<string, CallFact> {
  const facts: Record<string, CallFact> = {};
  for (const event of events) {
    if (event.type === 'tool.requested') {
      facts[event.callId] = { tool: event.tool, outcome: 'unfinished', resultSeq: null };
    } else if (event.type === 'tool.decided' && event.decision === 'deny') {
      const fact = facts[event.callId];
      if (fact) fact.outcome = 'denied';
    } else if (event.type === 'tool.result') {
      const fact = facts[event.callId];
      if (fact) {
        fact.outcome = event.ok ? 'ok' : 'failed';
        fact.resultSeq = event.seq;
      }
    }
  }
  return facts;
}

export type EvidenceStatus =
  /** The call ran and succeeded: this is real evidence. */
  | 'ok'
  | 'failed'
  | 'denied'
  | 'unfinished'
  /** No such call in this run: the agent made the id up or cited another run. */
  | 'unknown'
  /** The report itself, another report, or a call that finished after the report. */
  | 'invalid';

export interface EvidenceCheck {
  callId: string;
  status: EvidenceStatus;
  /** The tool the id belongs to; null when it is unknown. */
  tool: string | null;
}

export type Verdict = 'supported' | 'partial' | 'unsupported';

export interface ClaimCheck {
  text: string;
  evidence: EvidenceCheck[];
  /** supported: every cited call is real evidence. partial: some are. unsupported: none are. */
  verdict: Verdict;
}

function checkEvidence(
  callId: string,
  facts: Readonly<Record<string, CallFact>>,
  reportCallId: string,
): EvidenceCheck {
  const fact = facts[callId];
  if (!fact) return { callId, status: 'unknown', tool: null };
  if (callId === reportCallId || fact.tool === REPORT_TOOL) {
    return { callId, status: 'invalid', tool: fact.tool };
  }
  const reportResult = facts[reportCallId]?.resultSeq ?? null;
  if (reportResult !== null && fact.resultSeq !== null && fact.resultSeq > reportResult) {
    return { callId, status: 'invalid', tool: fact.tool };
  }
  return { callId, status: fact.outcome, tool: fact.tool };
}

/** Check each claim of one report call against what happened in the run. */
export function checkReport(
  report: ReportArgs,
  facts: Readonly<Record<string, CallFact>>,
  reportCallId: string,
): ClaimCheck[] {
  return report.claims.map((claim) => {
    const evidence = [...new Set(claim.evidence)].map((id) =>
      checkEvidence(id, facts, reportCallId),
    );
    const good = evidence.filter((item) => item.status === 'ok').length;
    const verdict: Verdict =
      good === 0 ? 'unsupported' : good === evidence.length ? 'supported' : 'partial';
    return { text: claim.text, evidence, verdict };
  });
}

export interface ReportTally {
  supported: number;
  partial: number;
  unsupported: number;
}

export function tally(checks: readonly ClaimCheck[]): ReportTally {
  const result: ReportTally = { supported: 0, partial: 0, unsupported: 0 };
  for (const check of checks) result[check.verdict] += 1;
  return result;
}

const REASON: Record<EvidenceStatus, string> = {
  ok: 'ok',
  failed: 'that call failed',
  denied: 'that call was refused, so it never ran',
  unfinished: 'that call has not finished',
  unknown: 'there is no such call in this run',
  invalid: 'that call cannot be used as evidence',
};

/** The text returned to the agent, so it can fix a report instead of repeating it. */
export function describeChecks(checks: readonly ClaimCheck[]): string {
  const counts = tally(checks);
  const lines = [
    `Report recorded: ${checks.length} claims, ${counts.supported} supported, ` +
      `${counts.partial} partly supported, ${counts.unsupported} without evidence.`,
  ];
  checks.forEach((check, index) => {
    if (check.verdict === 'supported') return;
    const label = `Claim ${index + 1} ("${check.text.slice(0, 60)}")`;
    if (check.evidence.length === 0) {
      lines.push(`- ${label} cites no tool call.`);
      return;
    }
    for (const item of check.evidence) {
      if (item.status !== 'ok') lines.push(`- ${label}: ${item.callId}: ${REASON[item.status]}.`);
    }
  });
  if (counts.partial + counts.unsupported > 0) {
    lines.push(
      'The user sees these marked as unverified. Either run the tool call that proves the claim ' +
        'and report again, or state plainly in your answer that you did not verify it.',
    );
  }
  return lines.join('\n');
}
