import { describe, expect, it } from 'vitest';

import { layoutItems, summarizeSteps, summaryText } from '@/state/group';
import type { ChatItem, ToolCard } from '@/state/timeline';

const text = (id: string): ChatItem => ({ kind: 'text', id, text: id });
const tool = (callId: string): ChatItem => ({ kind: 'tool', id: `t-${callId}`, callId });
const card = (callId: string, status: ToolCard['status']): ToolCard => ({
  callId,
  tool: 'list_dir',
  args: {},
  risk: 'read',
  status,
});

describe('layoutItems', () => {
  it('does not group a run without tool calls', () => {
    expect(layoutItems([text('a')], 'completed')).toEqual({ grouped: false, items: [text('a')] });
  });

  it('keeps everything in the group while the run is going', () => {
    const items = [text('a'), tool('1'), text('b')];
    expect(layoutItems(items, 'running')).toEqual({ grouped: true, steps: items, answer: null });
  });

  it('pulls the final text out as the answer once the run has ended', () => {
    const items = [text('a'), tool('1'), text('answer')];
    expect(layoutItems(items, 'completed')).toEqual({
      grouped: true,
      steps: [text('a'), tool('1')],
      answer: text('answer'),
    });
  });

  it('has no answer when the run ends on a tool step', () => {
    const items = [text('a'), tool('1')];
    expect(layoutItems(items, 'failed')).toEqual({ grouped: true, steps: items, answer: null });
  });
});

describe('summarizeSteps', () => {
  const tools = {
    '1': card('1', 'done'),
    '2': card('2', 'failed'),
    '3': card('3', 'denied'),
    '4': card('4', 'running'),
  };

  it('counts each outcome and ignores narration', () => {
    const steps = [text('a'), tool('1'), tool('2'), tool('3'), tool('4')];
    expect(summarizeSteps(steps, tools)).toEqual({
      total: 4,
      done: 1,
      failed: 1,
      denied: 1,
      active: 1,
    });
  });

  it('skips a step whose card is missing', () => {
    expect(summarizeSteps([tool('9')], tools).total).toBe(0);
  });
});

describe('summaryText', () => {
  it('only mentions problems when there are some', () => {
    const base = { total: 3, done: 3, failed: 0, denied: 0, active: 0 };
    expect(summaryText(base, 'completed')).toBe('已处理 · 3 步');
    expect(summaryText({ ...base, done: 1, failed: 1, denied: 1 }, 'completed')).toBe(
      '已处理 · 3 步 · 1 失败 · 1 被拒绝',
    );
    expect(summaryText(base, 'running')).toBe('处理中 · 3 步');
  });
});
