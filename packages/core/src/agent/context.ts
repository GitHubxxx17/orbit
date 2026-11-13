import type { ChatMessage } from '../llm/types.js';

export interface BudgetOptions {
  /** Upper bound on the size of the conversation, counted in characters (a stand-in for tokens). */
  maxChars: number;
  /** The most recent tool outputs that are kept in full. Default 6. */
  keepToolOutputs?: number;
}

const SHORT_OUTPUT = 200;
const ARGS_SHOWN = 120;

function sizeOf(message: ChatMessage): number {
  let size = message.content?.length ?? 0;
  if (message.role === 'assistant' && message.toolCalls) {
    for (const call of message.toolCalls) size += call.name.length + call.arguments.length;
  }
  return size;
}

const totalOf = (messages: readonly ChatMessage[]) =>
  messages.reduce((sum, message) => sum + sizeOf(message), 0);

/** The index of the newest assistant message that asked for tools; -1 if there is none. */
function lastAskIndex(messages: readonly ChatMessage[]): number {
  return messages.findLastIndex((m) => m.role === 'assistant' && m.toolCalls?.length);
}

/**
 * Where masking should stop so that the newest `keep` tool outputs, and every answer to the
 * latest batch of tool calls, stay whole. Tool outputs before the returned index may be masked.
 * The latest batch is never masked, however large: the model has not seen it yet.
 */
export function frontierFor(messages: readonly ChatMessage[], keep: number): number {
  const toolIndexes = messages.flatMap((m, i) => (m.role === 'tool' ? [i] : []));
  const newest = toolIndexes.at(-Math.max(keep, 1)) ?? 0;
  const lastAsk = lastAskIndex(messages);
  return lastAsk === -1 ? newest : Math.min(newest, lastAsk);
}

/**
 * Like `frontierFor`, but keeps the newest tool outputs that fit in `keepChars` characters instead
 * of a fixed number. Reading many small files and a few large ones then leaves the same amount in
 * the conversation, and what the model just looked at is not thrown away because it came late.
 * The latest batch is always kept whole.
 */
export function frontierBySize(messages: readonly ChatMessage[], keepChars: number): number {
  let kept = 0;
  let frontier = messages.length;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message?.role !== 'tool') continue;
    kept += message.content.length;
    if (kept > keepChars) break;
    frontier = index;
  }
  const lastAsk = lastAskIndex(messages);
  return lastAsk === -1 ? frontier : Math.min(frontier, lastAsk);
}

/** What the model is told in place of an old tool output: which call it was and how big. */
function placeholder(name: string, args: string, length: number): string {
  const shown = args.length > ARGS_SHOWN ? `${args.slice(0, ARGS_SHOWN)}…` : args;
  return `[tool output omitted to save space: ${name} ${shown} returned ${length} characters; what you learned from it should be in your own notes above, and you can call it again if you need the exact text]`;
}

/**
 * Replace long tool outputs that come before `frontier` by a short note that keeps the record of
 * the call (its name and arguments) and drops its content. Returns a new array; short outputs and
 * everything from `frontier` on are left alone.
 */
export function maskBefore(messages: readonly ChatMessage[], frontier: number): ChatMessage[] {
  const calls = new Map<string, { name: string; arguments: string }>();
  for (const message of messages) {
    if (message.role === 'assistant') {
      for (const call of message.toolCalls ?? []) calls.set(call.id, call);
    }
  }
  return messages.map((message, index): ChatMessage => {
    if (index >= frontier || message.role !== 'tool' || message.content.length <= SHORT_OUTPUT) {
      return message;
    }
    const call = calls.get(message.toolCallId);
    return {
      ...message,
      content: placeholder(call?.name ?? 'tool', call?.arguments ?? '', message.content.length),
    };
  });
}

/**
 * Drop the oldest whole exchanges (a user message and everything up to the next one) until the
 * conversation fits. Dropping whole exchanges keeps every assistant tool call next to its tool
 * answers, which model APIs require. The system prompt and the latest exchange are never dropped,
 * so the result can still exceed the budget when the latest exchange alone is too large.
 */
export function dropOldExchanges(
  messages: readonly ChatMessage[],
  maxChars: number,
): ChatMessage[] {
  const head = messages.filter((m) => m.role === 'system');
  const rest = messages.filter((m) => m.role !== 'system');

  const exchanges: ChatMessage[][] = [];
  for (const message of rest) {
    if (message.role === 'user' || exchanges.length === 0) exchanges.push([message]);
    else exchanges[exchanges.length - 1]?.push(message);
  }

  const total = () => [...head, ...exchanges.flat()].reduce((sum, m) => sum + sizeOf(m), 0);
  while (exchanges.length > 1 && total() > maxChars) exchanges.shift();
  return [...head, ...exchanges.flat()];
}

/**
 * Keep a conversation inside a size budget without breaking it, in one pass: mask old tool
 * outputs (the usual bulk), then drop the oldest whole exchanges if it is still too big. Returns a
 * new array; the input is untouched. A run uses `ContextWindow` instead, which changes the history
 * far less often so the provider's prompt cache keeps working.
 */
export function fitToBudget(
  messages: readonly ChatMessage[],
  options: BudgetOptions,
): ChatMessage[] {
  const frontier = frontierFor(messages, options.keepToolOutputs ?? 6);
  return dropOldExchanges(maskBefore(messages, frontier), options.maxChars);
}

export interface ContextWindowOptions {
  /** Size limit in characters, used when the model's window is not known. */
  maxChars: number;
  /** The model's context window in tokens, if the user said; null when unknown. */
  windowTokens?: number | null;
  /** Share of the window at which old tool outputs are masked, 0 to 1. Default 0.7. */
  compactAt?: number;
  /** Tool outputs kept whole when masking happens, as a count. Default: as many as fit in half the trigger. */
  keepToolOutputs?: number;
}

/** Characters per token before the provider has told us; real counts replace it after a call. */
const DEFAULT_TOKENS_PER_CHAR = 0.4;
/** Leave this share of the window free for the answer when dropping exchanges as a last resort. */
const HARD_LIMIT = 0.9;
/** When masking, keep the newest tool outputs that fit in this share of the trigger size. */
const KEEP_SHARE = 0.5;

/**
 * Decides what is sent to the model on each call of one run.
 *
 * Providers cache the start of a request and charge much less for it, but only while this
 * request starts with exactly what the last one did. So old tool outputs are not trimmed a little
 * on every step; they are masked in one go, when the conversation has grown to `compactAt` of the
 * window, and then left alone until it grows that far again. Between those moments each request
 * is the previous one plus what was just added.
 *
 * The size is measured in tokens as the provider counts them: after each call `observe` learns
 * how many tokens the request really was, which turns characters into tokens for the next check.
 */
export class ContextWindow {
  private frontier = 0;
  private tokensPerChar = DEFAULT_TOKENS_PER_CHAR;

  constructor(private readonly options: ContextWindowOptions) {}

  /** The first message index whose tool output may be masked; it only ever moves forward. */
  get maskedBefore(): number {
    return this.frontier;
  }

  /** The sizes, in characters, at which masking starts and at which exchanges are dropped. */
  private limits(): { compactChars: number; hardChars: number } {
    const { windowTokens, maxChars, compactAt = 0.7 } = this.options;
    if (windowTokens) {
      return {
        compactChars: (windowTokens * compactAt) / this.tokensPerChar,
        hardChars: (windowTokens * HARD_LIMIT) / this.tokensPerChar,
      };
    }
    return { compactChars: maxChars * compactAt, hardChars: maxChars };
  }

  /** The request for the next call: `messages` with old tool outputs masked, if it is time. */
  prepare(messages: readonly ChatMessage[]): ChatMessage[] {
    const { compactChars, hardChars } = this.limits();
    let view = maskBefore(messages, this.frontier);
    if (totalOf(view) > compactChars) {
      // Keep the newest outputs that fit in half the trigger, so masking frees real room and the
      // next one is a long way off; a count can be given instead.
      const next =
        this.options.keepToolOutputs === undefined
          ? frontierBySize(messages, compactChars * KEEP_SHARE)
          : frontierFor(messages, this.options.keepToolOutputs);
      if (next > this.frontier) {
        this.frontier = next;
        view = maskBefore(messages, this.frontier);
      }
    }
    return totalOf(view) > hardChars ? dropOldExchanges(view, hardChars) : view;
  }

  /** Learn from a finished call: the provider counted `promptTokens` for `sentChars` characters. */
  observe(promptTokens: number, sentChars: number): void {
    if (promptTokens > 0 && sentChars > 0) this.tokensPerChar = promptTokens / sentChars;
  }

  /** The size of a request in characters, for `observe`. */
  static sizeOf(messages: readonly ChatMessage[]): number {
    return totalOf(messages);
  }
}
