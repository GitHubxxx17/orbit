import type { OrbitEvent } from '@orbit/protocol';
import { describe, expect, it } from 'vitest';

import { summarizeSession } from '../src/session-summary.js';

function log(runId: string, startTs: number, ...drafts: Record<string, unknown>[]): OrbitEvent[] {
  return drafts.map(
    (draft, index) =>
      ({
        ...draft,
        id: `${runId}-${index + 1}`,
        runId,
        seq: index + 1,
        ts: startTs + index,
      }) as OrbitEvent,
  );
}

const started = { type: 'run.started', agentId: 'a', workspace: '/w' };
const asked = (text: string) => ({ type: 'user.message', text });
const said = (text: string) => ({ type: 'message.delta', text });
const done = { type: 'run.completed' };
const toolRequest = {
  type: 'tool.requested',
  callId: 'c1',
  tool: 'write_file',
  args: {},
  risk: 'write',
};

describe('summarizeSession', () => {
  it('takes the title from the first question and the snippet from the final answer', () => {
    const run = log(
      'r1',
      100,
      started,
      asked('帮我看看这个工作区'),
      said('先看目录。'),
      toolRequest,
      { type: 'tool.decided', callId: 'c1', decision: 'allow', by: 'policy' },
      { type: 'tool.result', callId: 'c1', ok: true, output: 'x' },
      said('这个工作区有'),
      said(' 3 个文件。'),
      done,
    );
    expect(summarizeSession('s1', [run])).toMatchObject({
      sessionId: 's1',
      title: '帮我看看这个工作区',
      snippet: '这个工作区有 3 个文件。',
      runCount: 1,
      status: 'idle',
      updatedAt: 108,
    });
  });

  it('shortens long titles and snippets to one line', () => {
    const run = log(
      'r1',
      0,
      started,
      asked(`${'问'.repeat(60)}\n第二行`),
      said('答\n\n'.repeat(80)),
      done,
    );
    const summary = summarizeSession('s', [run]);
    expect(summary.title).toBe(`${'问'.repeat(40)}…`);
    expect(summary.snippet.endsWith('…')).toBe(true);
    expect(summary.snippet).not.toContain('\n');
  });

  it('counts runs and describes the latest one', () => {
    const first = log('r1', 0, started, asked('one'), said('a'), done);
    const second = log('r2', 50, started, asked('two'), said('b'));
    expect(summarizeSession('s', [first, second])).toMatchObject({
      title: 'one',
      snippet: 'b',
      runCount: 2,
      status: 'running',
    });
  });

  it('flags a run that waits for the user', () => {
    const run = log('r1', 0, started, asked('x'), toolRequest, {
      type: 'approval.requested',
      approvalId: 'a1',
      items: [{ callId: 'c1', preview: '+x' }],
    });
    expect(summarizeSession('s', [run]).status).toBe('awaiting');
  });

  it('flags a failure but not a run the user stopped', () => {
    const failed = log('r1', 0, started, asked('x'), { type: 'run.failed', reason: 'model error' });
    const stopped = log('r2', 0, started, asked('x'), { type: 'run.failed', reason: 'cancelled' });
    expect(summarizeSession('s', [failed]).status).toBe('failed');
    expect(summarizeSession('s', [stopped]).status).toBe('idle');
  });

  it('copes with a session that has no events yet', () => {
    expect(summarizeSession('s', [])).toMatchObject({
      title: '新会话',
      snippet: '',
      status: 'idle',
    });
  });
});
