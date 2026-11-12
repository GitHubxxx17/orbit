import type { ChatMessage } from '../llm/types.js';

export interface BudgetOptions {
  /** Upper bound on the size of the conversation, counted in characters (a stand-in for tokens). */
  maxChars: number;
  /** The most recent tool outputs that are kept in full. Default 6. */
  keepToolOutputs?: number;
}

const OMITTED = '[earlier tool output omitted to save space]';
const SHORT_OUTPUT = 200;

function sizeOf(message: ChatMessage): number {
  let size = message.content?.length ?? 0;
  if (message.role === 'assistant' && message.toolCalls) {
    for (const call of message.toolCalls) size += call.name.length + call.arguments.length;
  }
  return size;
}

/**
 * Keep a conversation inside a size budget without breaking it:
 * 1. old tool outputs (the usual bulk) are replaced by a short note, the newest few stay;
 * 2. if it is still too big, the oldest whole exchanges are dropped, where an exchange is a user
 *    message and everything up to the next one. Dropping whole exchanges keeps every assistant
 *    tool call next to its tool answers, which model APIs require.
 * The system prompt and the latest exchange are never dropped, so the result can still exceed the
 * budget when the latest exchange alone is too large. Returns a new array; the input is untouched.
 */
export function fitToBudget(
  messages: readonly ChatMessage[],
  options: BudgetOptions,
): ChatMessage[] {
  const keep = options.keepToolOutputs ?? 6;

  const toolIndexes = messages.flatMap((m, i) => (m.role === 'tool' ? [i] : []));
  const stale = new Set(toolIndexes.slice(0, Math.max(0, toolIndexes.length - keep)));
  const trimmed = messages.map((message, index): ChatMessage =>
    stale.has(index) && message.role === 'tool' && message.content.length > SHORT_OUTPUT
      ? { ...message, content: OMITTED }
      : message,
  );

  const head = trimmed.filter((m) => m.role === 'system');
  const rest = trimmed.filter((m) => m.role !== 'system');

  // Split into exchanges at each user message.
  const exchanges: ChatMessage[][] = [];
  for (const message of rest) {
    if (message.role === 'user' || exchanges.length === 0) exchanges.push([message]);
    else exchanges[exchanges.length - 1]?.push(message);
  }

  const total = () => [...head, ...exchanges.flat()].reduce((sum, m) => sum + sizeOf(m), 0);
  while (exchanges.length > 1 && total() > options.maxChars) exchanges.shift();

  return [...head, ...exchanges.flat()];
}
