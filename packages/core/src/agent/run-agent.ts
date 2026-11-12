import type { RiskLevel } from '@orbit/protocol';

import type { EventStore } from '../event-store.js';
import type { ChatMessage, FinishReason, LlmClient, ToolCall } from '../llm/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import { readOnlyPolicy, type Policy } from './policy.js';

export interface RunAgentOptions {
  runId: string;
  agentId: string;
  workspace: string;
  llm: LlmClient;
  store: EventStore;
  registry: ToolRegistry;
  systemPrompt: string;
  /** The user's request for this run. */
  prompt: string;
  policy?: Policy;
  /** Upper bound on model calls, so a confused model cannot loop forever. Default 10. */
  maxSteps?: number;
  signal?: AbortSignal;
}

export type RunResult = { status: 'completed' } | { status: 'failed'; reason: string };

const DEFAULT_MAX_STEPS = 10;

/**
 * The agent loop: call the model, run the tools it asks for, feed results back, repeat until it
 * answers without requesting tools. Every step is recorded as an event; the returned value is only
 * a convenience, the event log is the source of truth.
 */
export async function runAgent(options: RunAgentOptions): Promise<RunResult> {
  const { runId, store, signal } = options;
  const maxSteps = options.maxSteps ?? DEFAULT_MAX_STEPS;

  store.append(runId, {
    type: 'run.started',
    agentId: options.agentId,
    workspace: options.workspace,
  });

  const fail = (reason: string): RunResult => {
    store.append(runId, { type: 'run.failed', reason });
    return { status: 'failed', reason };
  };

  const messages: ChatMessage[] = [
    { role: 'system', content: options.systemPrompt },
    { role: 'user', content: options.prompt },
  ];

  try {
    for (let step = 0; step < maxSteps; step++) {
      if (signal?.aborted) return fail('cancelled');

      const turn = await streamTurn(options, messages);
      messages.push({
        role: 'assistant',
        content: turn.text === '' ? null : turn.text,
        ...(turn.toolCalls.length > 0 ? { toolCalls: turn.toolCalls } : {}),
      });

      if (turn.toolCalls.length === 0) {
        if (turn.finishReason === 'length') return fail('model output was truncated');
        store.append(runId, { type: 'run.completed' });
        return { status: 'completed' };
      }

      for (const call of turn.toolCalls) {
        const content = await handleToolCall(options, call);
        messages.push({ role: 'tool', toolCallId: call.id, content });
      }
    }
    return fail(`stopped after reaching the limit of ${maxSteps} steps`);
  } catch (error) {
    if (signal?.aborted) return fail('cancelled');
    return fail(`model error: ${error instanceof Error ? error.message : String(error)}`);
  }
}

interface Turn {
  text: string;
  toolCalls: ToolCall[];
  finishReason: FinishReason;
}

/** One model call: stream text into message.delta events and collect the requested tool calls. */
async function streamTurn(options: RunAgentOptions, messages: ChatMessage[]): Promise<Turn> {
  const turn: Turn = { text: '', toolCalls: [], finishReason: 'unknown' };
  const specs = options.registry.specs();
  const request = { messages, ...(specs.length > 0 ? { tools: specs } : {}) };

  for await (const event of options.llm.stream(request, options.signal)) {
    if (event.type === 'text-delta') {
      turn.text += event.text;
      options.store.append(options.runId, { type: 'message.delta', text: event.text });
    } else if (event.type === 'tool-call') {
      turn.toolCalls.push(event.call);
    } else {
      turn.finishReason = event.reason;
    }
  }
  return turn;
}

/**
 * Record request -> decision -> (result), run the tool if allowed, and return the text that is
 * sent back to the model. Failures become tool results, not exceptions: the model can recover.
 */
async function handleToolCall(options: RunAgentOptions, call: ToolCall): Promise<string> {
  const { runId, store } = options;
  const policy = options.policy ?? readOnlyPolicy;
  const tool = options.registry.get(call.name);
  const risk: RiskLevel = tool?.risk ?? 'dangerous';
  const parsed = parseArguments(call.arguments);

  store.append(runId, {
    type: 'tool.requested',
    callId: call.id,
    tool: call.name,
    args: parsed.args,
    risk,
  });

  // An unknown tool is always denied, whatever the policy says.
  const decision =
    tool === undefined ? 'deny' : policy({ tool: call.name, risk, args: parsed.args });
  store.append(runId, { type: 'tool.decided', callId: call.id, decision, by: 'policy' });

  if (tool === undefined) return `Error: unknown tool "${call.name}".`;
  if (decision === 'deny') return `Denied: policy does not allow "${call.name}" (risk: ${risk}).`;

  let ok = true;
  let output: string;
  try {
    if (!parsed.valid) throw new Error('arguments must be a JSON object');
    output = await tool.run(parsed.args, {
      signal: options.signal ?? new AbortController().signal,
    });
  } catch (error) {
    ok = false;
    output = `Error: ${error instanceof Error ? error.message : String(error)}`;
  }
  store.append(runId, { type: 'tool.result', callId: call.id, ok, output });
  return output;
}

/** The model produces argument text; it may be malformed. Never trust it. */
function parseArguments(raw: string): { valid: boolean; args: Record<string, unknown> } {
  try {
    const value: unknown = raw.trim() === '' ? {} : JSON.parse(raw);
    if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
      return { valid: true, args: value as Record<string, unknown> };
    }
  } catch {
    // fall through to the invalid result
  }
  return { valid: false, args: {} };
}
