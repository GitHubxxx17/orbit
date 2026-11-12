import type { OrbitEvent } from '@orbit/protocol';
import { describe, expect, it } from 'vitest';
import { checkInvariants } from '../src/invariants.js';

type Draft = Omit<OrbitEvent, 'id' | 'runId' | 'seq' | 'ts'> | Record<string, unknown>;

/** Build a log with correct ids and seq so each test only breaks one thing. */
function log(...drafts: Draft[]): OrbitEvent[] {
  return drafts.map(
    (d, i) => ({ ...d, id: `e${i + 1}`, runId: 'r', seq: i + 1, ts: 1 }) as OrbitEvent,
  );
}

const start = { type: 'run.started', agentId: 'a', workspace: '/w' };
const req = {
  type: 'tool.requested',
  callId: 'c1',
  tool: 't',
  args: {},
  risk: 'read',
};
const allow = { type: 'tool.decided', callId: 'c1', decision: 'allow', by: 'policy' };
const result = { type: 'tool.result', callId: 'c1', ok: true, output: '' };
const done = { type: 'run.completed' };

const codes = (events: OrbitEvent[]) => checkInvariants(events).map((v) => v.code);

describe('checkInvariants', () => {
  it('accepts a consistent log', () => {
    expect(codes(log(start, req, allow, result, done))).toEqual([]);
  });

  it('accepts a run still in progress with an open tool call', () => {
    expect(codes(log(start, req, allow))).toEqual([]);
  });

  it('flags a seq gap', () => {
    const events = log(start, done);
    events[1] = { ...events[1]!, seq: 3 };
    expect(codes(events)).toContain('seq-gap');
  });

  it('flags a log that does not begin with run.started', () => {
    expect(codes(log(done))).toContain('missing-run-started');
  });

  it('flags events after the terminal event', () => {
    expect(codes(log(start, done, { type: 'message.delta', text: 'x' }))).toContain(
      'event-after-terminal',
    );
  });

  it('flags a second terminal event', () => {
    expect(codes(log(start, done, { type: 'run.failed', reason: 'x' }))).toContain(
      'event-after-terminal',
    );
  });

  it('flags a decision without a request', () => {
    expect(codes(log(start, allow))).toContain('decision-without-request');
  });

  it('flags a duplicate decision', () => {
    expect(codes(log(start, req, allow, allow))).toContain('duplicate-decision');
  });

  it('flags a result for a denied call', () => {
    const deny = { ...allow, decision: 'deny' };
    expect(codes(log(start, req, deny, result))).toContain('result-without-allow');
  });

  it('flags a finished run that leaves a tool call unresolved', () => {
    expect(codes(log(start, req, allow, done))).toContain('unresolved-tool-call');
  });
});
