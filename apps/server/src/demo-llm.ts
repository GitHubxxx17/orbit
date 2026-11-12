import type { LlmClient, LlmEvent } from '@orbit/core';

const sleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(new Error('aborted'));
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(new Error('aborted'));
      },
      { once: true },
    );
  });

/** Words are emitted a few at a time with a small delay so the UI visibly streams. */
function* chunks(text: string): Generator<string> {
  const size = 3;
  for (let i = 0; i < text.length; i += size) yield text.slice(i, i + size);
}

type Step = { text: string; call?: { name: string; args: unknown } };

/**
 * One scripted turn per model call, chosen by how many assistant messages came before.
 * It exercises all three tool outcomes: allowed, failed, and denied by policy.
 */
const SCRIPT: Step[] = [
  { text: '先看一下工作区里有什么。', call: { name: 'list_dir', args: {} } },
  {
    text: '再读一下 package.json。',
    call: { name: 'read_file', args: { path: 'package.json', limit: 8 } },
  },
  {
    text: '试着修改一个文件。',
    call: { name: 'write_file', args: { path: 'notes.txt', content: 'x' } },
  },
  {
    text: '写文件被策略拒绝了，所以我只做了只读的查看。以上就是这次演示：工具调用、策略决定和结果都记录成了事件，可以在右侧时间线回放。',
  },
];

/** A scripted stand-in for a real model, so the UI can be tried without any API key. */
export function createDemoLlm(delayMs = 25): LlmClient {
  return {
    async *stream(request, signal): AsyncGenerator<LlmEvent> {
      const turn = request.messages.filter((m) => m.role === 'assistant').length;
      const step = SCRIPT[Math.min(turn, SCRIPT.length - 1)];
      if (!step) return;

      for (const piece of chunks(step.text)) {
        await sleep(delayMs, signal);
        yield { type: 'text-delta', text: piece };
      }
      await sleep(delayMs * 8, signal);
      if (step.call) {
        yield {
          type: 'tool-call',
          call: {
            id: `demo-${turn + 1}`,
            name: step.call.name,
            arguments: JSON.stringify(step.call.args),
          },
        };
        yield { type: 'finish', reason: 'tool_calls', usage: null };
      } else {
        yield { type: 'finish', reason: 'stop', usage: null };
      }
    },
  };
}
