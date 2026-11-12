import { createInterface } from 'node:readline';
import { createOpenAICompatibleClient, loadLlmConfig, type ChatMessage } from '@orbit/core';

/**
 * Minimal terminal chat used to verify the model adapter end to end.
 * Ctrl+C cancels the generation in progress; Ctrl+C at an empty prompt exits.
 */
async function main(): Promise<void> {
  const llm = createOpenAICompatibleClient(loadLlmConfig(process.env));
  const history: ChatMessage[] = [{ role: 'system', content: 'You are a concise assistant.' }];

  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '> ' });
  let current: AbortController | null = null;
  let closed = false;
  rl.on('close', () => {
    closed = true;
  });
  rl.on('SIGINT', () => (current ? current.abort() : rl.close()));
  // Piped input can close the interface while a reply is still streaming.
  const prompt = () => {
    if (!closed) rl.prompt();
  };

  prompt();
  for await (const line of rl) {
    const text = line.trim();
    if (text === '') {
      prompt();
      continue;
    }

    history.push({ role: 'user', content: text });
    const controller = new AbortController();
    current = controller;
    let reply = '';

    try {
      for await (const event of llm.stream({ messages: history }, controller.signal)) {
        if (event.type === 'text-delta') {
          process.stdout.write(event.text);
          reply += event.text;
        } else if (event.type === 'tool-call') {
          process.stdout.write(`\n[tool call ignored in this stage: ${event.call.name}]`);
        } else if (event.usage) {
          process.stderr.write(
            `\n[tokens: ${event.usage.promptTokens} in, ${event.usage.completionTokens} out]`,
          );
        }
      }
      history.push({ role: 'assistant', content: reply });
    } catch (error) {
      if (controller.signal.aborted) {
        process.stdout.write('\n[cancelled]');
        history.push({ role: 'assistant', content: reply });
      } else {
        // Drop the unanswered user turn so a retry does not send it twice.
        history.pop();
        process.stderr.write(`\nError: ${error instanceof Error ? error.message : String(error)}`);
      }
    } finally {
      current = null;
    }
    process.stdout.write('\n');
    prompt();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
