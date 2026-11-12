import type { OrbitEvent } from '@orbit/protocol';

import type { ChatMessage, ToolCall } from '../llm/types.js';

/**
 * Rebuild the conversation the model saw from the event logs of earlier runs. History is derived,
 * not stored: the logs are the only source of truth.
 *
 * Some wording sent to the model is not in the events (for example why a call was refused), so
 * the rebuilt text of a refusal is a faithful paraphrase, not a byte-for-byte copy.
 */
export function historyFromRuns(runs: readonly (readonly OrbitEvent[])[]): ChatMessage[] {
  return runs.flatMap((events) => historyFromRun(events));
}

interface Call {
  callId: string;
  tool: string;
  args: Record<string, unknown>;
  risk: string;
  decision?: { allowed: boolean; by: 'policy' | 'user' };
  result?: string;
}

function toolMessage(call: Call): string {
  if (call.result !== undefined) return call.result;
  if (call.decision && !call.decision.allowed) {
    return call.decision.by === 'user'
      ? `Denied: the user rejected "${call.tool}".`
      : `Denied: policy does not allow "${call.tool}" (risk: ${call.risk}).`;
  }
  // The run was cancelled or failed before this call finished.
  return 'The run ended before this call finished.';
}

function historyFromRun(events: readonly OrbitEvent[]): ChatMessage[] {
  const messages: ChatMessage[] = [];
  let text = '';
  let calls: Call[] = [];

  // One model turn = its text, then the tool calls it asked for, then their outcomes.
  const endTurn = () => {
    if (text === '' && calls.length === 0) return;
    const toolCalls: ToolCall[] = calls.map((call) => ({
      id: call.callId,
      name: call.tool,
      arguments: JSON.stringify(call.args),
    }));
    messages.push({
      role: 'assistant',
      content: text === '' ? null : text,
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    });
    // Every tool call must be answered, or the model API rejects the conversation.
    for (const call of calls) {
      messages.push({ role: 'tool', toolCallId: call.callId, content: toolMessage(call) });
    }
    text = '';
    calls = [];
  };

  for (const event of events) {
    switch (event.type) {
      case 'user.message':
        endTurn();
        messages.push({ role: 'user', content: event.text });
        break;
      case 'message.delta':
        // Text after tool outcomes starts a new turn.
        if (calls.length > 0) endTurn();
        text += event.text;
        break;
      case 'tool.requested':
        calls.push({ callId: event.callId, tool: event.tool, args: event.args, risk: event.risk });
        break;
      case 'tool.decided': {
        const call = calls.find((candidate) => candidate.callId === event.callId);
        if (call) call.decision = { allowed: event.decision === 'allow', by: event.by };
        break;
      }
      case 'tool.result': {
        const call = calls.find((candidate) => candidate.callId === event.callId);
        if (call) call.result = event.output;
        break;
      }
      default:
        break;
    }
  }
  endTurn();
  return messages;
}
