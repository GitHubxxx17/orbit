import { describe, expect, it } from 'vitest';

import { fitToBudget } from '../../src/agent/context.js';
import type { ChatMessage } from '../../src/llm/types.js';

const system: ChatMessage = { role: 'system', content: 'sys' };
const user = (content: string): ChatMessage => ({ role: 'user', content });
const answer = (content: string): ChatMessage => ({ role: 'assistant', content });
const toolTurn = (id: string, output: string): ChatMessage[] => [
  { role: 'assistant', content: null, toolCalls: [{ id, name: 'read_file', arguments: '{}' }] },
  { role: 'tool', toolCallId: id, content: output },
];
const big = (n: number) => 'x'.repeat(n);

/** Every tool message must follow an assistant message that asked for that call. */
function pairingIsIntact(messages: ChatMessage[]): boolean {
  const asked = new Set<string>();
  for (const message of messages) {
    if (message.role === 'assistant') message.toolCalls?.forEach((call) => asked.add(call.id));
    if (message.role === 'tool' && !asked.has(message.toolCallId)) return false;
  }
  return true;
}

describe('fitToBudget', () => {
  it('returns an equal copy when the conversation fits', () => {
    const messages = [system, user('hi'), answer('hello')];
    const fitted = fitToBudget(messages, { maxChars: 1000 });
    expect(fitted).toEqual(messages);
    expect(fitted).not.toBe(messages);
  });

  it('replaces old long tool outputs but keeps the newest ones and short ones', () => {
    const messages = [
      system,
      user('q'),
      ...toolTurn('c1', big(500)),
      ...toolTurn('c2', 'short'),
      ...toolTurn('c3', big(500)),
    ];
    const fitted = fitToBudget(messages, { maxChars: 100_000, keepToolOutputs: 1 });
    const outputs = fitted.flatMap((m) => (m.role === 'tool' ? [m.content] : []));
    expect(outputs[0]).toBe('[earlier tool output omitted to save space]');
    expect(outputs[1]).toBe('short');
    expect(outputs[2]).toBe(big(500));
  });

  it('drops the oldest whole exchanges first and keeps the system prompt and the latest one', () => {
    const messages = [
      system,
      user('first'),
      ...toolTurn('c1', big(300)),
      answer('a1'),
      user('second'),
      answer(big(300)),
      user('third'),
      answer('a3'),
    ];
    const fitted = fitToBudget(messages, { maxChars: 300 });
    expect(fitted[0]).toEqual(system);
    expect(fitted.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['third']);
    expect(pairingIsIntact(fitted)).toBe(true);
  });

  it('drops only as much as needed', () => {
    const messages = [
      system,
      user('first'),
      answer(big(200)),
      user('second'),
      answer(big(200)),
      user('third'),
      answer('a3'),
    ];
    const fitted = fitToBudget(messages, { maxChars: 300 });
    expect(fitted.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
      'second',
      'third',
    ]);
  });

  it('never drops the latest exchange, even when it alone is over budget', () => {
    const messages = [system, user('old'), answer('x'), user('latest'), answer(big(5000))];
    const fitted = fitToBudget(messages, { maxChars: 100 });
    expect(fitted.filter((m) => m.role === 'user').map((m) => m.content)).toEqual(['latest']);
  });

  it('does not change the messages it was given', () => {
    const messages = [system, user('a'), ...toolTurn('c1', big(500)), user('b'), answer(big(500))];
    const snapshot = JSON.stringify(messages);
    fitToBudget(messages, { maxChars: 100, keepToolOutputs: 0 });
    expect(JSON.stringify(messages)).toBe(snapshot);
  });
});
