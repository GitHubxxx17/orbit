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
 * It exercises a read the policy allows and a write that waits for the user's approval.
 */
const SCRIPT: Step[] = [
  { text: '先看一下工作区里有什么。', call: { name: 'list_dir', args: {} } },
  {
    text: '再读一下 package.json。',
    call: { name: 'read_file', args: { path: 'package.json', limit: 8 } },
  },
  {
    text: '我想写一个笔记文件，这需要你批准。',
    call: {
      name: 'write_file',
      args: {
        path: '.orbit-demo/notes.txt',
        content: '星轨演示：这个文件由智能体在你批准后写入。\n',
      },
    },
  },
  {
    text: '演示结束。写文件这一步由你审批（选了“只读”则会被直接拒绝），批准后才会真正写盘；每一步和你的选择都记录成了事件，可以在右侧时间线回放。',
  },
];

/** A scripted stand-in for a real model, so the UI can be tried without any API key. */
export function createDemoLlm(delayMs = 25): LlmClient {
  return {
    async *stream(request, signal): AsyncGenerator<LlmEvent> {
      const users = request.messages.filter((m) => m.role === 'user');
      // A follow-up in the same conversation: answer from what the model was shown, which proves
      // that earlier turns reach it.
      const previous = users.length > 1 ? users[users.length - 2] : undefined;
      if (previous) {
        const text = `这是同一会话里的第 ${users.length} 条消息。我能看到之前的对话，你上一条说的是：“${previous.content}”。`;
        for (const piece of chunks(text)) {
          await sleep(delayMs, signal);
          yield { type: 'text-delta', text: piece };
        }
        yield { type: 'finish', reason: 'stop', usage: null };
        return;
      }

      // Steps of the first message: count the assistant turns since the last user message.
      const lastUser = request.messages.map((m) => m.role).lastIndexOf('user');
      const turn = request.messages
        .slice(lastUser + 1)
        .filter((m) => m.role === 'assistant').length;
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
