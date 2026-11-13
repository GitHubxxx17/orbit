import { describe, expect, it } from 'vitest';

import type { SessionSummary } from '@/api';
import { groupSessions } from '@/state/groups';

const ws = (id: string, path: string) => ({ id, name: path.split('/').at(-1) ?? '', path });

const s = (id: string, workspace: string, updatedAt: number, name?: string): SessionSummary => ({
  sessionId: id,
  title: id,
  snippet: '',
  runCount: 1,
  status: 'idle',
  updatedAt,
  workspace,
  workspaceName: name ?? workspace.split('/').at(-1) ?? '',
});

describe('groupSessions', () => {
  it('groups by workspace and puts the most recently used group and session first', () => {
    const groups = groupSessions([
      s('a1', '/w/a', 10),
      s('b1', '/w/b', 30),
      s('a2', '/w/a', 20),
      s('b2', '/w/b', 5),
    ]);
    expect(groups.map((g) => g.name)).toEqual(['b', 'a']);
    expect(groups[0]?.sessions.map((x) => x.sessionId)).toEqual(['b1', 'b2']);
    expect(groups[1]?.sessions.map((x) => x.sessionId)).toEqual(['a2', 'a1']);
  });

  it('keeps sessions of an unknown workspace together, under a readable name', () => {
    const groups = groupSessions([s('x', '', 1, ''), s('y', '', 2, '')]);
    expect(groups).toHaveLength(1);
    expect(groups[0]?.name).toBe('未知工作区');
  });

  it('is empty for no sessions and does not change its input', () => {
    expect(groupSessions([])).toEqual([]);
    const input = [s('a', '/w/a', 1), s('b', '/w/a', 2)];
    groupSessions(input);
    expect(input.map((x) => x.sessionId)).toEqual(['a', 'b']);
  });

  it('shows a registered workspace even with no conversation, after the active ones', () => {
    const groups = groupSessions(
      [s('a1', '/w/a', 10)],
      [ws('w-new', '/w/new'), ws('w-a', '/w/a'), ws('w-2', '/w/two')],
    );
    expect(groups.map((g) => g.name)).toEqual(['a', 'new', 'two']);
    expect(groups.map((g) => g.workspaceId)).toEqual(['w-a', 'w-new', 'w-2']);
    expect(groups[1]?.sessions).toEqual([]);
  });

  it('puts a session of an unregistered folder in its own group with no workspace id', () => {
    const groups = groupSessions([s('x', '/old/place', 5)], [ws('w-a', '/w/a')]);
    expect(groups.find((g) => g.key === '/old/place')).toMatchObject({ workspaceId: null });
  });
});
