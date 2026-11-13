import type { OrbitEvent, RiskLevel } from '@orbit/protocol';

export type ToolCallStatus =
  'requested' | 'awaiting' | 'denied' | 'running' | 'succeeded' | 'failed';

export interface ToolCallState {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  risk: RiskLevel;
  status: ToolCallStatus;
  decidedBy: 'policy' | 'user' | null;
  output: string | null;
}

export type RunStatus = 'idle' | 'running' | 'completed' | 'failed';

export interface RunState {
  status: RunStatus;
  agentId: string | null;
  workspace: string | null;
  /** What the user asked, from the user.message event. */
  prompt: string | null;
  /** Concatenated assistant text from message.delta events. */
  text: string;
  toolCalls: ToolCallState[];
  failureReason: string | null;
  /** Highest seq folded into this state; use it as the cursor for incremental reads. */
  lastSeq: number;
}

export const initialRunState: RunState = {
  status: 'idle',
  agentId: null,
  workspace: null,
  prompt: null,
  text: '',
  toolCalls: [],
  failureReason: null,
  lastSeq: 0,
};

function updateCall(
  calls: ToolCallState[],
  callId: string,
  patch: (call: ToolCallState) => ToolCallState,
): ToolCallState[] {
  return calls.map((call) => (call.callId === callId ? patch(call) : call));
}

/**
 * Fold one event into the state. Pure: never mutates its inputs, so the same function can
 * drive a full replay on the server and incremental updates in the UI.
 */
export function applyEvent(state: RunState, event: OrbitEvent): RunState {
  const next = { ...state, lastSeq: event.seq };
  switch (event.type) {
    case 'run.started':
      return { ...next, status: 'running', agentId: event.agentId, workspace: event.workspace };
    case 'user.message':
      return { ...next, prompt: event.text };
    case 'message.delta':
      return { ...next, text: state.text + event.text };
    case 'tool.requested':
      return {
        ...next,
        toolCalls: [
          ...state.toolCalls,
          {
            callId: event.callId,
            tool: event.tool,
            args: event.args,
            risk: event.risk,
            status: 'requested',
            decidedBy: null,
            output: null,
          },
        ],
      };
    case 'tool.decided':
      return {
        ...next,
        toolCalls: updateCall(state.toolCalls, event.callId, (call) => ({
          ...call,
          status: event.decision === 'allow' ? 'running' : 'denied',
          decidedBy: event.by,
        })),
      };
    case 'approval.requested': {
      const waiting = new Set(event.items.map((item) => item.callId));
      return {
        ...next,
        toolCalls: state.toolCalls.map((call) =>
          waiting.has(call.callId) ? { ...call, status: 'awaiting' } : call,
        ),
      };
    }
    case 'tool.result':
      return {
        ...next,
        toolCalls: updateCall(state.toolCalls, event.callId, (call) => ({
          ...call,
          status: event.ok ? 'succeeded' : 'failed',
          output: event.output,
        })),
      };
    case 'file.changed':
    case 'file.rolledback':
    case 'model.usage':
      // Effects and costs are for audit and display; they do not change what the run looks like.
      return next;
    case 'run.completed':
      return { ...next, status: 'completed' };
    case 'run.failed':
      return { ...next, status: 'failed', failureReason: event.reason };
  }
}

/** Derive the full run state from its event log. */
export function projectRun(events: readonly OrbitEvent[]): RunState {
  return events.reduce(applyEvent, initialRunState);
}
