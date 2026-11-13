import type { SessionSummary, WorkspaceInfo } from '@/api';

export interface SessionGroup {
  /** The workspace folder; sessions of one folder share a group. */
  key: string;
  name: string;
  /** The id when this is a registered workspace; a new chat can be started in it. */
  workspaceId: string | null;
  sessions: SessionSummary[];
  /** The latest activity in the group; groups are shown most recent first. */
  updatedAt: number;
}

/**
 * Sessions grouped by the workspace they belong to. A registered workspace always has a group, even
 * with no conversation yet, so a newly added folder is visible at once. Groups and the sessions
 * inside them are ordered by latest activity (empty groups last, in registration order). A session
 * whose workspace is not registered gets a group of its own.
 */
export function groupSessions(
  sessions: readonly SessionSummary[],
  registered: readonly WorkspaceInfo[] = [],
): SessionGroup[] {
  const groups = new Map<string, SessionGroup>();
  for (const workspace of registered) {
    groups.set(workspace.path, {
      key: workspace.path,
      name: workspace.name,
      workspaceId: workspace.id,
      sessions: [],
      updatedAt: 0,
    });
  }
  for (const session of sessions) {
    const key = session.workspace;
    const group = groups.get(key) ?? {
      key,
      name: session.workspaceName || '未知工作区',
      workspaceId: null,
      sessions: [],
      updatedAt: 0,
    };
    group.sessions.push(session);
    group.updatedAt = Math.max(group.updatedAt, session.updatedAt);
    groups.set(key, group);
  }
  const order = new Map(registered.map((w, index) => [w.path, index]));
  return [...groups.values()]
    .map((group) => ({
      ...group,
      sessions: [...group.sessions].sort((a, b) => b.updatedAt - a.updatedAt),
    }))
    .sort(
      (a, b) =>
        b.updatedAt - a.updatedAt ||
        (order.get(a.key) ?? Number.MAX_SAFE_INTEGER) -
          (order.get(b.key) ?? Number.MAX_SAFE_INTEGER),
    );
}
