import type { OrbitEvent } from '@orbit/protocol';
import { describe, expect, it } from 'vitest';

import { historyFromRuns } from '../../src/agent/history.js';

type Draft = Record<string, unknown>;

/** Build a well-formed log from drafts so each test only describes what it cares about. */
function log(...drafts: Draft[]): OrbitEvent[] {
  return drafts.map(
    (draft, index) =>
      ({ ...draft, id: `e${index + 1}`, runId: 'r', seq: index + 1, ts: 0 }) as OrbitEvent,
  );
}

const started: Draft = { type: 'run.started', agentId: 'a', workspace: '/w' };
const user = (text: string): Draft => ({ type: 'user.message', text });
const delta = (text: string): Draft => ({ type: 'message.delta', text });
const requested = (callId: string, tool = 'read_file', risk = 'read'): Draft => ({
  type: 'tool.requested',
  callId,
  tool,
  args: { path: `${callId}.ts` },
  risk,
});
const decided = (callId: string, decision: 'allow' | 'deny', by: 'policy' | 'user'): Draft => ({
  type: 'tool.decided',
  callId,
  decision,
  by,
});
const result = (callId: string, output: string): Draft => ({
  type: 'tool.result',
  callId,
  ok: true,
  output,
});

describe('historyFromRuns', () => {
  it('turns a plain exchange into a user and an assistant message', () => {
    const history = historyFromRuns([log(started, user('hi'), delta('hel'), delta('lo'))]);
    expect(history).toEqual([
      { role: 'user', content: 'hi' },
      { role: 'assistant', content: 'hello' },
    ]);
  });

  it('rebuilds a tool turn: assistant with its calls, then the tool answers, then the next text', () => {
    const history = historyFromRuns([
      log(
        started,
        user('look'),
        delta('checking'),
        requested('c1'),
        decided('c1', 'allow', 'policy'),
        result('c1', 'file text'),
        delta('done'),
      ),
    ]);
    expect(history).toEqual([
      { role: 'user', content: 'look' },
      {
        role: 'assistant',
        content: 'checking',
        toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"c1.ts"}' }],
      },
      { role: 'tool', toolCallId: 'c1', content: 'file text' },
      { role: 'assistant', content: 'done' },
    ]);
  });

  it('groups several calls of one turn and answers each of them', () => {
    const history = historyFromRuns([
      log(
        started,
        user('x'),
        requested('c1'),
        requested('c2'),
        decided('c1', 'allow', 'policy'),
        decided('c2', 'allow', 'policy'),
        result('c1', 'one'),
        result('c2', 'two'),
      ),
    ]);
    expect(history.map((m) => m.role)).toEqual(['user', 'assistant', 'tool', 'tool']);
    expect(history[1]).toMatchObject({ content: null });
  });

  it('describes refusals, by the policy and by the user', () => {
    const history = historyFromRuns([
      log(
        started,
        user('x'),
        requested('c1', 'wipe', 'dangerous'),
        requested('c2', 'write_file', 'write'),
        decided('c1', 'deny', 'policy'),
        decided('c2', 'deny', 'user'),
      ),
    ]);
    expect(history.filter((m) => m.role === 'tool').map((m) => m.content)).toEqual([
      'Denied: policy does not allow "wipe" (risk: dangerous).',
      'Denied: the user rejected "write_file".',
    ]);
  });

  it('still answers a call whose run ended before it finished', () => {
    const history = historyFromRuns([log(started, user('x'), requested('c1'))]);
    expect(history.at(-1)).toEqual({
      role: 'tool',
      toolCallId: 'c1',
      content: 'The run ended before this call finished.',
    });
  });

  it('joins several runs in order', () => {
    const first = log(started, user('one'), delta('a'));
    const second = log(started, user('two'), delta('b'));
    expect(historyFromRuns([first, second]).map((m) => m.content)).toEqual([
      'one',
      'a',
      'two',
      'b',
    ]);
  });

  it('is empty for no runs', () => {
    expect(historyFromRuns([])).toEqual([]);
  });
});
