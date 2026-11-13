import { describe, expect, it } from 'vitest';

import {
  checkReport,
  describeChecks,
  factsFromEvents,
  ReportArgs,
  tally,
  type CallFact,
} from '../src/claims.js';
import type { OrbitEvent } from '../src/events.js';

let seq = 0;
const ev = (draft: Record<string, unknown>) =>
  ({ ...draft, id: `e${++seq}`, runId: 'r', seq, ts: 1 }) as OrbitEvent;

/** A run in which `a` succeeded, `b` failed, `c` was refused, `d` never finished. */
function run(): OrbitEvent[] {
  seq = 0;
  const requested = (callId: string, tool: string) =>
    ev({ type: 'tool.requested', callId, tool, args: {}, risk: 'read' });
  return [
    ev({ type: 'run.started', agentId: 'a', workspace: '/w' }),
    requested('a', 'read_file'),
    requested('b', 'read_file'),
    requested('c', 'write_file'),
    requested('d', 'grep'),
    ev({ type: 'tool.decided', callId: 'a', decision: 'allow', by: 'policy' }),
    ev({ type: 'tool.decided', callId: 'b', decision: 'allow', by: 'policy' }),
    ev({ type: 'tool.decided', callId: 'c', decision: 'deny', by: 'user' }),
    ev({ type: 'tool.decided', callId: 'd', decision: 'allow', by: 'policy' }),
    ev({ type: 'tool.result', callId: 'a', ok: true, output: 'x' }),
    ev({ type: 'tool.result', callId: 'b', ok: false, output: 'Error' }),
  ];
}

describe('ReportArgs', () => {
  it('accepts claims with and without evidence', () => {
    expect(
      ReportArgs.safeParse({
        claims: [
          { text: 'a', evidence: ['x'] },
          { text: 'b', evidence: [] },
        ],
      }).success,
    ).toBe(true);
  });

  it('rejects no claims, an empty claim, or a missing evidence list', () => {
    expect(ReportArgs.safeParse({ claims: [] }).success).toBe(false);
    expect(ReportArgs.safeParse({ claims: [{ text: ' ', evidence: [] }] }).success).toBe(false);
    expect(ReportArgs.safeParse({ claims: [{ text: 'a' }] }).success).toBe(false);
  });
});

describe('factsFromEvents', () => {
  it('records how each call ended', () => {
    const facts = factsFromEvents(run());
    expect(facts['a']).toMatchObject({ outcome: 'ok', tool: 'read_file' });
    expect(facts['b']?.outcome).toBe('failed');
    expect(facts['c']?.outcome).toBe('denied');
    expect(facts['d']).toEqual({ tool: 'grep', outcome: 'unfinished', resultSeq: null });
  });
});

describe('checkReport', () => {
  const facts = factsFromEvents(run());
  const check = (evidence: string[]) =>
    checkReport({ claims: [{ text: 't', evidence }] }, facts, 'report')[0];

  it('marks a claim backed by a successful call as supported', () => {
    expect(check(['a'])).toMatchObject({ verdict: 'supported' });
  });

  it('marks a claim with no evidence as unsupported', () => {
    expect(check([])).toMatchObject({ verdict: 'unsupported', evidence: [] });
  });

  it.each([
    ['b', 'failed'],
    ['c', 'denied'],
    ['d', 'unfinished'],
    ['made-up', 'unknown'],
  ] as const)('does not accept %s as evidence (%s)', (callId, status) => {
    expect(check([callId])).toMatchObject({
      verdict: 'unsupported',
      evidence: [{ callId, status }],
    });
  });

  it('is partial when only some of the cited calls are real evidence', () => {
    expect(check(['a', 'b'])?.verdict).toBe('partial');
  });

  it('counts a repeated id once', () => {
    expect(check(['a', 'a'])?.evidence).toHaveLength(1);
  });

  it('refuses the report itself, another report, and calls that finished after it', () => {
    const withReports: Record<string, CallFact> = {
      ...facts,
      report: { tool: 'report', outcome: 'ok', resultSeq: 20 },
      older: { tool: 'report', outcome: 'ok', resultSeq: 12 },
      late: { tool: 'read_file', outcome: 'ok', resultSeq: 25 },
    };
    const verdict = (id: string) =>
      checkReport({ claims: [{ text: 't', evidence: [id] }] }, withReports, 'report')[0]
        ?.evidence[0]?.status;
    expect(verdict('report')).toBe('invalid');
    expect(verdict('older')).toBe('invalid');
    expect(verdict('late')).toBe('invalid');
  });

  it('accepts any finished call while the report has no result yet', () => {
    expect(check(['a'])?.verdict).toBe('supported');
  });
});

describe('tally and feedback', () => {
  const facts = factsFromEvents(run());
  const checks = checkReport(
    {
      claims: [
        { text: 'good', evidence: ['a'] },
        { text: 'mixed', evidence: ['a', 'b'] },
        { text: 'bare', evidence: [] },
        { text: 'invented', evidence: ['made-up'] },
      ],
    },
    facts,
    'report',
  );

  it('counts verdicts', () => {
    expect(tally(checks)).toEqual({ supported: 1, partial: 1, unsupported: 2 });
  });

  it('tells the agent exactly what is wrong, so it can fix the report', () => {
    const text = describeChecks(checks);
    expect(text).toContain('4 claims, 1 supported, 1 partly supported, 2 without evidence');
    expect(text).toContain('b: that call failed');
    expect(text).toContain('cites no tool call');
    expect(text).toContain('made-up: there is no such call in this run');
    expect(text).not.toContain('"good"');
  });

  it('says nothing about fixing when everything is supported', () => {
    const text = describeChecks(
      checkReport({ claims: [{ text: 'ok', evidence: ['a'] }] }, facts, 'r'),
    );
    expect(text).not.toContain('marked as unverified');
  });
});
