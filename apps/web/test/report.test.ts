import type { OrbitEvent } from '@orbit/protocol';
import { describe, expect, it } from 'vitest';

import { missingReport, reportOf, withoutReport } from '@/state/report';
import { applyEvents, emptyRun } from '@/state/timeline';

let seq = 0;
const ev = (draft: Record<string, unknown>) =>
  ({ ...draft, id: `e${++seq}`, runId: 'r', seq, ts: 1 }) as OrbitEvent;

const requested = (callId: string, tool: string, args: Record<string, unknown> = {}) =>
  ev({ type: 'tool.requested', callId, tool, args, risk: 'read' });
const allowed = (callId: string) =>
  ev({ type: 'tool.decided', callId, decision: 'allow', by: 'policy' });
const denied = (callId: string) =>
  ev({ type: 'tool.decided', callId, decision: 'deny', by: 'user' });
const result = (callId: string, ok = true) =>
  ev({ type: 'tool.result', callId, ok, output: 'out' });

/** Events of a run in which `read` succeeded, `write` was refused, then a report was made. */
function run(claims: unknown, extra: OrbitEvent[] = []) {
  seq = 0;
  return applyEvents(emptyRun, [
    ev({ type: 'run.started', agentId: 'a', workspace: '/w' }),
    requested('read', 'read_file', { path: 'a.txt' }),
    allowed('read'),
    result('read'),
    requested('write', 'write_file', { path: 'b.txt', content: 'x' }),
    denied('write'),
    requested('rep', 'report', { claims }),
    allowed('rep'),
    ...extra,
    result('rep'),
  ]);
}

describe('reportOf', () => {
  it('checks every claim against what really happened', () => {
    const report = reportOf(
      run([
        { text: 'read it', evidence: ['read'] },
        { text: 'wrote it', evidence: ['write'] },
        { text: 'tests pass', evidence: [] },
      ]),
    );
    expect(report?.checks.map((c) => c.verdict)).toEqual([
      'supported',
      'unsupported',
      'unsupported',
    ]);
    expect(report?.tally).toEqual({ supported: 1, partial: 0, unsupported: 2 });
    expect(report?.checks[1]?.evidence[0]?.status).toBe('denied');
  });

  it('says nothing until the report has been recorded', () => {
    const view = run([{ text: 'x', evidence: [] }]);
    const pending = {
      ...view,
      tools: { ...view.tools, rep: { ...view.tools['rep']!, status: 'running' as const } },
    };
    expect(reportOf(pending)).toBeNull();
  });

  it('ignores a report whose arguments are malformed', () => {
    expect(reportOf(run('not a list'))).toBeNull();
    expect(reportOf(run([]))).toBeNull();
  });

  it('uses the newest report when the agent reports again', () => {
    const second = [
      requested('rep2', 'report', { claims: [{ text: 'fixed', evidence: ['read'] }] }),
      allowed('rep2'),
      result('rep2'),
    ];
    const report = reportOf(applyEvents(run([{ text: 'first', evidence: [] }]), second));
    expect(report?.callId).toBe('rep2');
    expect(report?.checks.map((c) => c.text)).toEqual(['fixed']);
  });

  it('does not accept an earlier report as evidence', () => {
    const second = [
      requested('rep2', 'report', { claims: [{ text: 'cites a report', evidence: ['rep'] }] }),
      allowed('rep2'),
      result('rep2'),
    ];
    const report = reportOf(applyEvents(run([{ text: 'first', evidence: [] }]), second));
    expect(report?.checks[0]?.evidence[0]?.status).toBe('invalid');
  });

  it('is null when no report was made', () => {
    expect(reportOf(emptyRun)).toBeNull();
  });
});

describe('withoutReport', () => {
  it('drops the report step but keeps text and other tools', () => {
    const view = run([{ text: 'x', evidence: [] }]);
    const kept = withoutReport(view.items, view.tools);
    const tools = kept.flatMap((item) => (item.kind === 'tool' ? [item.callId] : []));
    expect(tools).toEqual(['read', 'write']);
  });
});

describe('missingReport', () => {
  const finished = [ev({ type: 'run.completed' })];
  /** A run that used read_file and then ended, with the given extra events in between. */
  const used = (extra: () => OrbitEvent[] = () => []) => {
    seq = 0;
    return applyEvents(emptyRun, [
      ev({ type: 'run.started', agentId: 'a', workspace: '/w' }),
      requested('read', 'read_file'),
      allowed('read'),
      result('read'),
      ...extra(),
      ev({ type: 'run.completed' }),
    ]);
  };

  it('flags a finished run that used tools but never reported', () => {
    expect(missingReport(used())).toBe('missing');
  });

  it('flags a report call that did not go through', () => {
    const failedReport = () => [
      requested('rep', 'report', { claims: [] }),
      allowed('rep'),
      result('rep', false),
    ];
    expect(missingReport(used(failedReport))).toBe('failed');
  });

  it('is silent when a report was recorded', () => {
    const ok = () => [
      requested('rep', 'report', { claims: [{ text: 'x', evidence: ['read'] }] }),
      allowed('rep'),
      result('rep'),
    ];
    expect(missingReport(used(ok))).toBeNull();
  });

  it('is silent for a run that only chatted, or one still going', () => {
    seq = 0;
    const chat = applyEvents(emptyRun, [
      ev({ type: 'run.started', agentId: 'a', workspace: '/w' }),
      ...finished,
    ]);
    expect(missingReport(chat)).toBeNull();
    expect(missingReport({ ...used(), status: 'running' })).toBeNull();
  });
});
