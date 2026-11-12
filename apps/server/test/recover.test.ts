import { checkInvariants, InMemoryEventStore, InMemorySessionStore, projectRun } from '@orbit/core';
import { describe, expect, it } from 'vitest';

import { recoverInterruptedRuns } from '../src/recover.js';

function setup() {
  return { events: new InMemoryEventStore(), sessions: new InMemorySessionStore() };
}

const started = { type: 'run.started', agentId: 'a', workspace: '/w' } as const;
const requested = (callId: string) =>
  ({ type: 'tool.requested', callId, tool: 'write_file', args: {}, risk: 'write' }) as const;

describe('recoverInterruptedRuns', () => {
  it('closes a run that was cut off in the middle of an answer', () => {
    const { events, sessions } = setup();
    sessions.create('s1');
    sessions.addRun('s1', 'r1');
    events.append('r1', started);
    events.append('r1', { type: 'message.delta', text: 'half an ans' });

    expect(recoverInterruptedRuns(sessions, events)).toBe(1);
    const log = events.read('r1');
    expect(log.at(-1)).toMatchObject({ type: 'run.failed' });
    expect(projectRun(log).status).toBe('failed');
    expect(checkInvariants(log)).toEqual([]);
  });

  it('refuses calls that were still waiting for the user, so the log stays consistent', () => {
    const { events, sessions } = setup();
    sessions.create('s1');
    sessions.addRun('s1', 'r1');
    events.append('r1', started);
    events.append('r1', requested('c1'));
    events.append('r1', {
      type: 'approval.requested',
      approvalId: 'a1',
      items: [{ callId: 'c1', preview: '+x' }],
    });

    recoverInterruptedRuns(sessions, events);
    const log = events.read('r1');
    expect(log.find((e) => e.type === 'tool.decided')).toMatchObject({
      callId: 'c1',
      decision: 'deny',
    });
    expect(checkInvariants(log)).toEqual([]);
  });

  it('records a call that had started as failed', () => {
    const { events, sessions } = setup();
    sessions.create('s1');
    sessions.addRun('s1', 'r1');
    events.append('r1', started);
    events.append('r1', requested('c1'));
    events.append('r1', { type: 'tool.decided', callId: 'c1', decision: 'allow', by: 'policy' });

    recoverInterruptedRuns(sessions, events);
    expect(events.read('r1').find((e) => e.type === 'tool.result')).toMatchObject({
      callId: 'c1',
      ok: false,
    });
    expect(checkInvariants(events.read('r1'))).toEqual([]);
  });

  it('leaves finished runs and runs with no events alone', () => {
    const { events, sessions } = setup();
    sessions.create('s1');
    sessions.addRun('s1', 'done');
    sessions.addRun('s1', 'empty');
    events.append('done', started);
    events.append('done', { type: 'run.completed' });

    expect(recoverInterruptedRuns(sessions, events)).toBe(0);
    expect(events.read('done')).toHaveLength(2);
    expect(events.read('empty')).toEqual([]);
  });

  it('is safe to run twice', () => {
    const { events, sessions } = setup();
    sessions.create('s1');
    sessions.addRun('s1', 'r1');
    events.append('r1', started);

    expect(recoverInterruptedRuns(sessions, events)).toBe(1);
    expect(recoverInterruptedRuns(sessions, events)).toBe(0);
    expect(events.read('r1')).toHaveLength(2);
  });
});
