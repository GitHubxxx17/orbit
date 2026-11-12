import { describe, expect, it } from 'vitest';
import { InMemoryEventStore } from '../src/event-store.js';
import { applyEvent, initialRunState, projectRun } from '../src/projection.js';

function store() {
  let id = 0;
  return new InMemoryEventStore({ now: () => 1 }, { next: () => `e${(id += 1)}` });
}

describe('projectRun', () => {
  it('returns the idle state for an empty log', () => {
    expect(projectRun([])).toEqual(initialRunState);
  });

  it('concatenates message deltas and tracks the lifecycle', () => {
    const s = store();
    s.append('r', { type: 'run.started', agentId: 'a', workspace: '/w' });
    s.append('r', { type: 'message.delta', text: 'Hel' });
    s.append('r', { type: 'message.delta', text: 'lo' });
    const running = projectRun(s.read('r'));
    expect(running).toMatchObject({ status: 'running', text: 'Hello', agentId: 'a', lastSeq: 3 });

    s.append('r', { type: 'run.completed' });
    expect(projectRun(s.read('r')).status).toBe('completed');
  });

  it('follows a tool call from request to result', () => {
    const s = store();
    s.append('r', { type: 'run.started', agentId: 'a', workspace: '/w' });
    s.append('r', {
      type: 'tool.requested',
      callId: 'c1',
      tool: 'read_file',
      args: { path: 'a.ts' },
      risk: 'read',
    });
    s.append('r', { type: 'tool.decided', callId: 'c1', decision: 'allow', by: 'policy' });
    expect(projectRun(s.read('r')).toolCalls[0]).toMatchObject({
      status: 'running',
      decidedBy: 'policy',
    });
    s.append('r', { type: 'tool.result', callId: 'c1', ok: true, output: 'file body' });
    expect(projectRun(s.read('r')).toolCalls[0]).toMatchObject({
      status: 'succeeded',
      output: 'file body',
    });
  });

  it('marks a denied call as denied and records the failure reason', () => {
    const s = store();
    s.append('r', { type: 'run.started', agentId: 'a', workspace: '/w' });
    s.append('r', {
      type: 'tool.requested',
      callId: 'c1',
      tool: 'run_command',
      args: {},
      risk: 'dangerous',
    });
    s.append('r', { type: 'tool.decided', callId: 'c1', decision: 'deny', by: 'policy' });
    s.append('r', { type: 'run.failed', reason: 'blocked' });
    const state = projectRun(s.read('r'));
    expect(state.toolCalls[0]?.status).toBe('denied');
    expect(state).toMatchObject({ status: 'failed', failureReason: 'blocked' });
  });

  it('does not mutate the previous state', () => {
    const s = store();
    const started = s.append('r', { type: 'run.started', agentId: 'a', workspace: '/w' });
    const before = Object.freeze({ ...initialRunState });
    applyEvent(before, started);
    expect(before).toEqual(initialRunState);
  });

  it('gives the same result for full replay and incremental application', () => {
    const s = store();
    s.append('r', { type: 'run.started', agentId: 'a', workspace: '/w' });
    s.append('r', { type: 'message.delta', text: 'x' });
    s.append('r', { type: 'run.completed' });
    const events = s.read('r');
    expect(events.reduce(applyEvent, initialRunState)).toEqual(projectRun(events));
  });
});

describe('projectRun: approvals', () => {
  it('marks a call as awaiting until the user decides', () => {
    const s = store();
    s.append('r', { type: 'run.started', agentId: 'a', workspace: '/w' });
    s.append('r', {
      type: 'tool.requested',
      callId: 'c1',
      tool: 'write_file',
      args: {},
      risk: 'write',
    });
    s.append('r', {
      type: 'approval.requested',
      approvalId: 'a1',
      items: [{ callId: 'c1', preview: '+x' }],
    });
    expect(projectRun(s.read('r')).toolCalls[0]?.status).toBe('awaiting');

    s.append('r', { type: 'tool.decided', callId: 'c1', decision: 'allow', by: 'user' });
    expect(projectRun(s.read('r')).toolCalls[0]).toMatchObject({
      status: 'running',
      decidedBy: 'user',
    });
  });
});
