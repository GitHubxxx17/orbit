import type { OrbitEvent, RiskLevel } from '@orbit/protocol';

/**
 * The view of a run, derived only from its events. There is no other state: replaying the same
 * events always rebuilds the same screen.
 */

export type ToolStatus = 'pending' | 'awaiting' | 'running' | 'done' | 'failed' | 'denied';

export interface ToolCard {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  risk: RiskLevel;
  status: ToolStatus;
  decidedBy?: 'policy' | 'user';
  output?: string;
  /** Set while the call waits for the user: which approval it belongs to and what would change. */
  approvalId?: string;
  preview?: string;
  /** The tool really changed a file (file.changed); only then can the change be undone. */
  changed?: boolean;
  /** The change was undone later (file.rolledback). */
  rolledBack?: boolean;
}

export type ChatItem =
  { kind: 'text'; id: string; text: string } | { kind: 'tool'; id: string; callId: string };

/** One line in the event timeline. Consecutive text deltas are folded into a single row. */
export interface TimelineRow {
  id: string;
  seq: number;
  type: OrbitEvent['type'];
  label: string;
  count: number;
}

export type RunStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface RunView {
  runId: string | null;
  /** What the user asked in this run (the user.message event). */
  prompt: string | null;
  /** Which agent ran it, from run.started; tells demo runs from live ones. */
  agentId: string | null;
  /** Event timestamps (epoch ms), used to show how long a run took. */
  startedAt: number | null;
  endedAt: number | null;
  status: RunStatus;
  failReason: string | null;
  lastSeq: number;
  items: ChatItem[];
  tools: Record<string, ToolCard>;
  rows: TimelineRow[];
}

export const emptyRun: RunView = {
  runId: null,
  prompt: null,
  agentId: null,
  startedAt: null,
  endedAt: null,
  status: 'idle',
  failReason: null,
  lastSeq: 0,
  items: [],
  tools: {},
  rows: [],
};

export function labelOf(event: OrbitEvent): string {
  switch (event.type) {
    case 'run.started':
      return '运行开始';
    case 'user.message':
      return '用户提问';
    case 'message.delta':
      return '模型输出';
    case 'tool.requested':
      return `请求工具 ${event.tool}`;
    case 'tool.decided':
      return event.decision === 'allow' ? '策略放行' : '策略拒绝';
    case 'approval.requested':
      return `等待审批（${event.items.length} 项）`;
    case 'tool.result':
      return event.ok ? '工具成功' : '工具失败';
    case 'file.changed':
      return `文件已修改 ${event.path}`;
    case 'file.rolledback':
      return `已撤销 ${event.path}`;
    case 'run.completed':
      return '运行完成';
    case 'run.failed':
      return '运行失败';
  }
}

function addRow(rows: TimelineRow[], event: OrbitEvent): TimelineRow[] {
  const last = rows.at(-1);
  if (event.type === 'message.delta' && last?.type === 'message.delta') {
    return [...rows.slice(0, -1), { ...last, count: last.count + 1 }];
  }
  return [
    ...rows,
    { id: event.id, seq: event.seq, type: event.type, label: labelOf(event), count: 1 },
  ];
}

function appendText(items: ChatItem[], event: OrbitEvent & { type: 'message.delta' }): ChatItem[] {
  const last = items.at(-1);
  // Only the last text item changes, so earlier items keep their identity and skip re-rendering.
  if (last?.kind === 'text') {
    return [...items.slice(0, -1), { ...last, text: last.text + event.text }];
  }
  return [...items, { kind: 'text', id: event.id, text: event.text }];
}

/** Fold one event into the view. Events at or before `lastSeq` are ignored (reconnect replays). */
export function applyEvent(view: RunView, event: OrbitEvent): RunView {
  if (event.seq <= view.lastSeq) return view;
  const next: RunView = {
    ...view,
    runId: event.runId,
    lastSeq: event.seq,
    rows: addRow(view.rows, event),
  };

  switch (event.type) {
    case 'run.started':
      return { ...next, status: 'running', agentId: event.agentId, startedAt: event.ts };
    case 'user.message':
      return { ...next, prompt: event.text };
    case 'message.delta':
      return { ...next, items: appendText(view.items, event) };
    case 'tool.requested':
      return {
        ...next,
        items: [...view.items, { kind: 'tool', id: event.id, callId: event.callId }],
        tools: {
          ...view.tools,
          [event.callId]: {
            callId: event.callId,
            tool: event.tool,
            args: event.args,
            risk: event.risk,
            status: 'pending',
          },
        },
      };
    case 'tool.decided': {
      const card = view.tools[event.callId];
      if (!card) return next;
      const status: ToolStatus = event.decision === 'allow' ? 'running' : 'denied';
      return {
        ...next,
        tools: { ...view.tools, [event.callId]: { ...card, status, decidedBy: event.by } },
      };
    }
    case 'approval.requested': {
      const tools = { ...view.tools };
      for (const item of event.items) {
        const card = tools[item.callId];
        if (card) {
          tools[item.callId] = {
            ...card,
            status: 'awaiting',
            approvalId: event.approvalId,
            preview: item.preview,
          };
        }
      }
      return { ...next, tools };
    }
    case 'tool.result': {
      const card = view.tools[event.callId];
      if (!card) return next;
      const status: ToolStatus = event.ok ? 'done' : 'failed';
      return {
        ...next,
        tools: { ...view.tools, [event.callId]: { ...card, status, output: event.output } },
      };
    }
    case 'file.changed':
    case 'file.rolledback': {
      const card = view.tools[event.callId];
      if (!card) return next;
      const patch = event.type === 'file.changed' ? { changed: true } : { rolledBack: true };
      return { ...next, tools: { ...view.tools, [event.callId]: { ...card, ...patch } } };
    }
    case 'run.completed':
      return { ...next, status: 'completed', endedAt: event.ts };
    case 'run.failed':
      return { ...next, status: 'failed', failReason: event.reason, endedAt: event.ts };
  }
}

export function applyEvents(view: RunView, events: readonly OrbitEvent[]): RunView {
  return events.reduce(applyEvent, view);
}
