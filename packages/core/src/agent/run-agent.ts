import { EARLY_STOP_PREFIX, type RiskLevel } from '@orbit/protocol';

import type { EventStore } from '../event-store.js';
import type { ChatMessage, FinishReason, LlmClient, ToolCall } from '../llm/types.js';
import type { ToolRegistry } from '../tools/registry.js';
import type { Tool } from '../tools/tool.js';
import { denyAllApprover, type Approver } from './approval.js';
import { ContextWindow } from './context.js';
import { readOnlyPolicy, type Policy } from './policy.js';

export interface RunAgentOptions {
  runId: string;
  agentId: string;
  workspace: string;
  /** Name of the model behind `llm`, recorded in run.started; omit it for the demo model. */
  modelName?: string;
  /** Name of the agent profile, recorded in run.started; omit it for the built-in agent. */
  agentName?: string;
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
  /** The model's context window in tokens, if known. Masking then starts at a share of it. */
  contextWindow?: number | null;
  /** Share of the window (0 to 1) at which old tool outputs are masked. Default 0.7. */
  compactAt?: number;
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

  /** Start counting this call from scratch. */
  forget(call: ToolCall): void {
    this.seen.delete(`${call.name}\u0000${normalize(call.arguments)}`);
  }
}

function normalize(raw: string): string {
  try {
    return JSON.stringify(JSON.parse(raw));
  } catch {
    return raw.trim();
  }
}

/**
 * Remembers read-only calls whose result is still in the conversation, so that asking for the same
 * thing again can be answered with a note instead of sending the same text a second time. A
 * result that has been masked is no longer in the conversation, and anything that wrote to the
 * workspace may have changed what a read would give: in both cases the call runs again.
 */
class ReadMemo {
  private readonly seen = new Map<string, { callId: string; index: number }>();

  private static key(call: ToolCall): string {
    return `${call.name}\u0000${normalize(call.arguments)}`;
  }

  /** The note to give instead of running `call` again, or null if it must run. */
  lookup(call: ToolCall, maskedBefore: number): string | null {
    const earlier = this.seen.get(ReadMemo.key(call));
    if (!earlier || earlier.index < maskedBefore) return null;
    return `Same call as ${earlier.callId}, and nothing has been written since: its result is unchanged and is earlier in this conversation. Use that instead of reading again.`;
  }

  /** True if `call` was made before and its result has since been masked out of the conversation. */
  wasMasked(call: ToolCall, maskedBefore: number): boolean {
    const earlier = this.seen.get(ReadMemo.key(call));
    return earlier !== undefined && earlier.index < maskedBefore;
  }

  /** Remember a call that really ran and produced output at message `index`. */
  remember(call: ToolCall, ran: boolean, index: number): void {
    if (ran) this.seen.set(ReadMemo.key(call), { callId: call.id, index });
  }

  /** A write may have changed any file: forget everything. */
  invalidate(): void {
    this.seen.clear();
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
    ...(options.agentName ? { agentName: options.agentName } : {}),
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
  // Old tool outputs are masked in one go when the conversation has grown, not trimmed on every
  // step, so each request keeps the start of the last one and the provider's prompt cache applies.
  const context = new ContextWindow({
    maxChars: options.maxContextChars ?? DEFAULT_MAX_CONTEXT_CHARS,
    windowTokens: options.contextWindow ?? null,
    ...(options.compactAt === undefined ? {} : { compactAt: options.compactAt }),
  });
  const repeats = new RepeatTracker();
  const reads = new ReadMemo();

  /** One model call with the conversation as `context` wants it sent. */
  const callModel = async (withTools = true): Promise<Turn> => {
    const sent = context.prepare(messages);
    const turn = await streamTurn(options, sent, withTools);
    if (turn.promptTokens !== null) context.observe(turn.promptTokens, ContextWindow.sizeOf(sent));
    return turn;
  };

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
    await callModel(false);
    return fail(`${EARLY_STOP_PREFIX}${why}`);
  };

  try {
    for (let step = 0; step < maxSteps; step++) {
      if (signal?.aborted) return fail('cancelled');

      // `messages` keeps everything; only the copy sent to the model is masked or trimmed.
      const turn = await callModel();
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

      // A read whose earlier result was masked is the model asking for what it can no longer see,
      // not going in circles: do not count it towards the loop limit.
      const reread = turn.toolCalls.map((call) => reads.wasMasked(call, context.maskedBefore));
      const { contents, wrote, ran } = await handleToolCalls(options, turn.toolCalls, (call) =>
        reads.lookup(call, context.maskedBefore),
      );
      if (wrote) reads.invalidate();
      turn.toolCalls.forEach((call, index) => {
        if (reread[index]) repeats.forget(call);
        reads.remember(call, ran[index] === true, messages.length);
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
  /** What the provider counted for the request; null when it did not say. */
  promptTokens: number | null;
}

/** One model call: stream text into message.delta events and collect the requested tool calls. */
async function streamTurn(
  options: RunAgentOptions,
  messages: ChatMessage[],
  withTools = true,
): Promise<Turn> {
  const turn: Turn = { text: '', toolCalls: [], finishReason: 'unknown', promptTokens: null };
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
        turn.promptTokens = event.usage.promptTokens;
        options.store.append(options.runId, {
          type: 'model.usage',
          promptTokens: event.usage.promptTokens,
          completionTokens: event.usage.completionTokens,
          ...(event.usage.cachedTokens === undefined
            ? {}
            : { cachedTokens: event.usage.cachedTokens }),
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
 * Returns the text sent back to the model for each call (failures become tool results, not
 * exceptions: the model can recover), whether anything that could write was run, and which calls
 * really ran a read-only tool (those can be remembered, see `ReadMemo`).
 */
async function handleToolCalls(
  options: RunAgentOptions,
  calls: ToolCall[],
  /** For a repeated read-only call: the note to give instead of running it, or null. */
  reuse: (call: ToolCall) => string | null,
): Promise<{ contents: string[]; wrote: boolean; ran: boolean[] }> {
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
  const ran: boolean[] = [];
  let wrote = false;
  for (const item of planned) {
    if (item.verdict !== 'allow' || !item.tool) {
      contents.push(item.refusal ?? `Denied: "${item.call.name}" was not allowed.`);
      ran.push(false);
      continue;
    }
    // A read-only call the model already made, whose result is still in the conversation and
    // cannot have changed: say so instead of sending the same text again.
    const note = item.tool.idempotent ? reuse(item.call) : null;
    if (note !== null) {
      store.append(runId, { type: 'tool.result', callId: item.call.id, ok: true, output: note });
      contents.push(note);
      ran.push(false);
      continue;
    }
    if (item.risk !== 'read') wrote = true;
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
    ran.push(ok && item.tool.idempotent === true);
  }
  return { contents, wrote, ran };
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
