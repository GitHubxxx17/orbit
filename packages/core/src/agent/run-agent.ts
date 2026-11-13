import { EARLY_STOP_PREFIX, type RiskLevel } from '@orbit/protocol';

import type { EventStore } from '../event-store.js';
import type { ChatMessage, FinishReason, LlmClient, ToolCall } from '../llm/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { Tool } from '../tools/tool.js';
import { denyAllApprover, type Approver } from './approval.js';
import { fitToBudget } from './context.js';
import { readOnlyPolicy, type Policy } from './policy.js';

export interface RunAgentOptions {
  runId: string;
  agentId: string;
  workspace: string;
  /** Name of the model behind `llm`, recorded in run.started; omit it for the demo model. */
  modelName?: string;
  llm: LlmClient;
  store: EventStore;
  registry: ToolRegistry;
  systemPrompt: string;
  /** The user's request for this run. */
  prompt: string;
  /** Earlier turns of the same conversation (see `historyFromRuns`). */
  history?: ChatMessage[];
  /** Size budget for what is sent to the model, in characters. Default 120000. */
  maxContextChars?: number;
  policy?: Policy;
  /** Asked when the policy answers "ask". Without one, every such call is refused. */
  approver?: Approver;
  /** Ids for approval requests; injectable so tests are deterministic. */
  newApprovalId?: () => string;
  /**
   * A safety ceiling on model calls, far above what real work needs, so a runaway cannot spend
   * money forever. Default 100. Going in circles is caught much earlier (see LOOP_REPEATS).
   */
  maxSteps?: number;
  signal?: AbortSignal;
}

export type RunResult = { status: 'completed' } | { status: 'failed'; reason: string };

const DEFAULT_MAX_STEPS = 100;
const DEFAULT_MAX_CONTEXT_CHARS = 120_000;
/** The same call returning the same result this many times in a row means the model is stuck. */
const LOOP_REPEATS = 3;

/** Counts how often each exact call (same tool, same arguments) has given the exact same result. */
class RepeatTracker {
  private readonly seen = new Map<string, { output: string; count: number }>();

  /** Record a finished call and return how many times in a row it has now given this result. */
  record(call: ToolCall, output: string): number {
    const key = `${call.name}\u0000${normalize(call.arguments)}`;
    const before = this.seen.get(key);
    // A changed result means something changed in between (a file was written): not a loop.
    const count = before && before.output === output ? before.count + 1 : 1;
    this.seen.set(key, { output, count });
    return count;
  }
}

function normalize(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return raw.trim();
  }
}

const WRAP_UP =
  'Do not call any more tools. Answer the request now using only what you have already read, ' +
  'and say clearly what you could not finish or are unsure about.';

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
    ...(options.modelName ? { model: options.modelName } : {}),
  });

  // Record what was asked, so the conversation can be rebuilt from the log alone.
  store.append(runId, { type: 'user.message', text: options.prompt });

  const fail = (reason: string): RunResult => {
    store.append(runId, { type: 'run.failed', reason });
    return { status: 'failed', reason };
  };

  const messages: ChatMessage[] = [
    { role: 'system', content: options.systemPrompt },
    ...(options.history ?? []),
    { role: 'user', content: options.prompt },
  ];
  const maxChars = options.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS;
  const repeats = new RepeatTracker();

  /**
   * End a run that is not getting anywhere, but not empty-handed: the model is asked once more,
   * without tools, to answer from what it has gathered. The run still ends as failed, with a reason
   * that says the answer may be incomplete. (A user's Stop is different: it ends at once.)
   */
  const wrapUp = async (why: 'loop' | 'steps', cause: string): Promise<RunResult> => {
    if (signal?.aborted) return fail('cancelled');
    messages.push({
      role: 'user',
      content: `[Orbit system notice, not written by the user] Orbit stopped your tool use because ${cause}. ${WRAP_UP} Do not say the user asked you to stop.`,
    });
    await streamTurn(options, fitToBudget(messages, { maxChars }), false);
    return fail(`${EARLY_STOP_PREFIX}${why}`);
  };

  try {
    for (let step = 0; step < maxSteps; step++) {
      if (signal?.aborted) return fail('cancelled');

      // `messages` keeps everything; only the copy sent to the model is trimmed to the budget.
      const turn = await streamTurn(options, fitToBudget(messages, { maxChars }));
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

      const contents = await handleToolCalls(options, turn.toolCalls);
      turn.toolCalls.forEach((call, index) => {
        messages.push({ role: 'tool', toolCallId: call.id, content: contents[index] ?? '' });
      });
      const stuck = turn.toolCalls.some(
        (call, index) => repeats.record(call, contents[index] ?? '') >= LOOP_REPEATS,
      );
      if (stuck) {
        return await wrapUp(
          'loop',
          `you made the same call with the same result ${LOOP_REPEATS} times`,
        );
      }
    }
    return await wrapUp('steps', `the safety limit of ${maxSteps} model calls was reached`);
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
async function streamTurn(
  options: RunAgentOptions,
  messages: ChatMessage[],
  withTools = true,
): Promise<Turn> {
  const turn: Turn = { text: '', toolCalls: [], finishReason: 'unknown' };
  const specs = withTools ? options.registry.specs() : [];
  const request = { messages, ...(specs.length > 0 ? { tools: specs } : {}) };

  for await (const event of options.llm.stream(request, options.signal)) {
    if (event.type === 'text-delta') {
      turn.text += event.text;
      options.store.append(options.runId, { type: 'message.delta', text: event.text });
    } else if (event.type === 'tool-call') {
      turn.toolCalls.push(event.call);
    } else {
      turn.finishReason = event.reason;
      // Record what the call cost when the provider says. Unknown stays unknown: no event.
      if (event.usage) {
        options.store.append(options.runId, {
          type: 'model.usage',
          promptTokens: event.usage.promptTokens,
          completionTokens: event.usage.completionTokens,
        });
      }
    }
  }
  return turn;
}

type Verdict = 'allow' | 'deny';

/** What the loop knows about one requested call while the turn is being handled. */
interface Planned {
  call: ToolCall;
  tool: Tool | undefined;
  risk: RiskLevel;
  parsed: { valid: boolean; args: Record<string, unknown> };
  verdict: Verdict | 'ask';
  decidedBy: 'policy' | 'user';
  /** Set when the call is refused, to tell the model why. */
  refusal?: string;
}

/**
 * Handle every tool call of one model turn, in three phases so that calls needing approval are
 * reviewed together rather than one dialog at a time:
 *   1. record each request and let the policy decide;
 *   2. ask the user once for all calls the policy could not decide;
 *   3. run the allowed calls in order.
 * Returns the text sent back to the model for each call. Failures become tool results, not
 * exceptions: the model can recover.
 */
async function handleToolCalls(options: RunAgentOptions, calls: ToolCall[]): Promise<string[]> {
  const { runId, store } = options;
  const policy = options.policy ?? readOnlyPolicy;
  const signal = options.signal ?? new AbortController().signal;

  // Phase 1: request and policy decision.
  const planned: Planned[] = calls.map((call) => {
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
    const verdict =
      tool === undefined ? 'deny' : policy({ tool: call.name, risk, args: parsed.args });
    const refusal =
      tool === undefined
        ? `Error: unknown tool "${call.name}".`
        : verdict === 'deny'
          ? `Denied: policy does not allow "${call.name}" (risk: ${risk}).`
          : undefined;
    return {
      call,
      tool,
      risk,
      parsed,
      verdict,
      decidedBy: 'policy',
      ...(refusal ? { refusal } : {}),
    };
  });

  // Preview the calls that need approval. A call that cannot even be previewed (bad arguments)
  // is refused now instead of bothering the user with it.
  const previews = new Map<string, string>();
  for (const item of planned) {
    if (item.verdict !== 'ask' || !item.tool) continue;
    try {
      if (!item.parsed.valid) throw new Error('arguments must be a JSON object');
      previews.set(item.call.id, (await item.tool.preview?.(item.parsed.args, { signal })) ?? '');
    } catch (error) {
      item.verdict = 'deny';
      item.refusal = `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  for (const item of planned) {
    if (item.verdict === 'ask') continue;
    store.append(runId, {
      type: 'tool.decided',
      callId: item.call.id,
      decision: item.verdict,
      by: 'policy',
    });
  }

  // Phase 2: one approval for everything the policy left open.
  const asked = planned.filter((item) => item.verdict === 'ask');
  if (asked.length > 0) {
    const approvalId = (options.newApprovalId ?? (() => crypto.randomUUID()))();
    const items = asked.map((item) => ({
      callId: item.call.id,
      preview: previews.get(item.call.id) ?? '',
    }));

    // Start waiting BEFORE announcing the request, so an answer that comes back the instant the
    // event is seen (for example from an in-process listener) always finds someone waiting.
    const waiting = (options.approver ?? denyAllApprover).request(
      {
        runId,
        approvalId,
        items: asked.map((item) => ({
          callId: item.call.id,
          tool: item.call.name,
          args: item.parsed.args,
          preview: previews.get(item.call.id) ?? '',
        })),
      },
      options.signal,
    );
    waiting.catch(() => undefined); // handled by the await below; avoids a stray rejection if append throws
    store.append(runId, { type: 'approval.requested', approvalId, items });
    const answers = await waiting;

    for (const item of asked) {
      // Anything the user did not explicitly allow is refused.
      item.verdict = answers[item.call.id] === 'allow' ? 'allow' : 'deny';
      item.decidedBy = 'user';
      if (item.verdict === 'deny') item.refusal = `Denied: the user rejected "${item.call.name}".`;
      store.append(runId, {
        type: 'tool.decided',
        callId: item.call.id,
        decision: item.verdict,
        by: 'user',
      });
    }
  }

  // Phase 3: run what was allowed, in the order the model asked.
  const contents: string[] = [];
  for (const item of planned) {
    if (item.verdict !== 'allow' || !item.tool) {
      contents.push(item.refusal ?? `Denied: "${item.call.name}" was not allowed.`);
      continue;
    }
    let ok = true;
    let output: string;
    try {
      if (!item.parsed.valid) throw new Error('arguments must be a JSON object');
      output = await item.tool.run(item.parsed.args, {
        signal,
        callId: item.call.id,
        events: () => store.read(runId),
        recordChange: (change) =>
          store.append(runId, { type: 'file.changed', callId: item.call.id, ...change }),
      });
    } catch (error) {
      ok = false;
      output = `Error: ${error instanceof Error ? error.message : String(error)}`;
    }
    store.append(runId, { type: 'tool.result', callId: item.call.id, ok, output });
    contents.push(output);
  }
  return contents;
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
