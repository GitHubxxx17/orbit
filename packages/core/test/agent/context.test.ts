import { describe, expect, it } from 'vitest';

import { ContextWindow, fitToBudget } from '../../src/agent/context.js';
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
    expect(outputs[0]).toContain('omitted to save space');
    expect(outputs[1]).toBe('short');
    expect(outputs[2]).toBe(big(500));
  });

  it('keeps every answer to the latest batch of parallel tool calls, however many', () => {
    const calls = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      name: 'read_file',
      arguments: '{}',
    }));
    const messages: ChatMessage[] = [
      system,
      user('q'),
      ...toolTurn('old', big(500)),
      { role: 'assistant', content: null, toolCalls: calls },
      ...calls.map((call): ChatMessage => ({
        role: 'tool',
        toolCallId: call.id,
        content: big(500),
      })),
    ];
    const fitted = fitToBudget(messages, { maxChars: 100_000, keepToolOutputs: 6 });
    const outputs = fitted.flatMap((m) => (m.role === 'tool' ? [m.content] : []));
    expect(outputs[0]).toContain('omitted to save space');
    expect(outputs.slice(1).every((o) => o === big(500))).toBe(true);
    expect(pairingIsIntact(fitted)).toBe(true);
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

describe('masking keeps the record of the call', () => {
  it('names the tool, shows its arguments and says how much was left out', () => {
    const messages: ChatMessage[] = [
      system,
      user('q'),
      {
        role: 'assistant',
        content: null,
        toolCalls: [{ id: 'c1', name: 'read_file', arguments: '{"path":"src/a.ts"}' }],
      },
      { role: 'tool', toolCallId: 'c1', content: big(500) },
      ...toolTurn('c2', big(500)),
    ];
    const fitted = fitToBudget(messages, { maxChars: 100_000, keepToolOutputs: 1 });
    const masked = fitted.find((m) => m.role === 'tool' && m.toolCallId === 'c1');
    expect(masked?.role === 'tool' && masked.content).toContain('read_file {"path":"src/a.ts"}');
    expect(masked?.role === 'tool' && masked.content).toContain('500 characters');
    expect(pairingIsIntact(fitted)).toBe(true);
  });
});

describe('ContextWindow', () => {
  /** A conversation of `turns` tool exchanges, each answer `size` characters long. */
  function conversation(turns: number, size: number): ChatMessage[] {
    return [
      system,
      user('q'),
      ...Array.from({ length: turns }, (_, i) => toolTurn(`c${i}`, big(size))).flat(),
    ];
  }
  const sent = (view: ChatMessage[]) => view.flatMap((m) => (m.role === 'tool' ? [m.content] : []));

  it('sends everything unchanged while the conversation is small', () => {
    const window = new ContextWindow({ maxChars: 10_000 });
    const messages = conversation(4, 500);
    expect(window.prepare(messages)).toEqual(messages);
    expect(window.maskedBefore).toBe(0);
  });

  it('masks old outputs once the conversation reaches the trigger, and then leaves it alone', () => {
    // 70% of 10 000 characters is 7 000: fifteen 500-character outputs cross it.
    const window = new ContextWindow({ maxChars: 10_000, keepToolOutputs: 2 });
    let messages = conversation(15, 500);
    const first = window.prepare(messages);
    expect(sent(first).filter((c) => c.includes('omitted')).length).toBeGreaterThan(0);

    // Each later request is the previous one plus what was added: nothing earlier changes.
    const before = first;
    messages = [...messages, ...toolTurn('c15', big(500))];
    const next = window.prepare(messages);
    expect(next.slice(0, before.length)).toEqual(before);
  });

  it('never moves the mask backwards', () => {
    const window = new ContextWindow({ maxChars: 10_000, keepToolOutputs: 2 });
    window.prepare(conversation(15, 500));
    const at = window.maskedBefore;
    window.prepare(conversation(3, 100));
    expect(window.maskedBefore).toBe(at);
  });

  it('measures against the model’s window in tokens once it knows how big a request was', () => {
    // A 1 000-token window, trigger at 70% = 700 tokens. At 0.5 tokens per character that is
    // 1 400 characters, so three 500-character outputs (1 500) are masked.
    const window = new ContextWindow({
      maxChars: 1_000_000,
      windowTokens: 1_000,
      keepToolOutputs: 1,
    });
    window.observe(500, 1_000);
    const view = window.prepare(conversation(3, 500));
    expect(sent(view).filter((c) => c.includes('omitted')).length).toBeGreaterThan(0);

    const roomy = new ContextWindow({ maxChars: 1_000_000, windowTokens: 1_000_000 });
    roomy.observe(500, 1_000);
    expect(sent(roomy.prepare(conversation(3, 500))).some((c) => c.includes('omitted'))).toBe(
      false,
    );
  });

  it('keeps the newest outputs that fit in half the trigger when no count is given', () => {
    // Trigger 7 000 characters; half of it, 3 500, is kept: seven 500-character outputs.
    const window = new ContextWindow({ maxChars: 10_000 });
    const view = window.prepare(conversation(15, 500));
    const outputs = sent(view);
    const whole = outputs.filter((c) => c === big(500)).length;
    expect(whole).toBe(7);
    expect(outputs.slice(0, 15 - 7).every((c) => c.includes('omitted'))).toBe(true);
  });

  it('keeps the latest batch whole even when it is larger than half the trigger', () => {
    const window = new ContextWindow({ maxChars: 10_000 });
    const calls = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`,
      name: 'read_file',
      arguments: '{}',
    }));
    const messages: ChatMessage[] = [
      system,
      user('q'),
      ...toolTurn('old', big(3_000)),
      { role: 'assistant', content: null, toolCalls: calls },
      ...calls.map((c): ChatMessage => ({ role: 'tool', toolCallId: c.id, content: big(700) })),
    ];
    const view = window.prepare(messages);
    const batch = view.slice(-10);
    expect(batch.every((m) => m.role === 'tool' && m.content === big(700))).toBe(true);
    expect(pairingIsIntact(view)).toBe(true);
  });

  it('keeps the newest tool outputs whole when it masks', () => {
    const window = new ContextWindow({ maxChars: 10_000, keepToolOutputs: 3 });
    const view = window.prepare(conversation(15, 500));
    const outputs = sent(view);
    expect(outputs.slice(-3).every((c) => c === big(500))).toBe(true);
    expect(pairingIsIntact(view)).toBe(true);
  });

  it('drops the oldest exchanges only as a last resort, and only as many as needed', () => {
    const window = new ContextWindow({ maxChars: 2_000 });
    const messages = [
      system,
      user('first'),
      answer(big(1_500)),
      user('second'),
      answer(big(1_500)),
      user('third'),
      answer('ok'),
    ];
    const view = window.prepare(messages);
    expect(view.filter((m) => m.role === 'user').map((m) => m.content)).toEqual([
      'second',
      'third',
    ]);
  });
});
