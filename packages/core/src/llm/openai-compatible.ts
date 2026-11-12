import { z } from 'zod';
import type { LlmConfig } from './config.js';
import { parseSse } from './sse.js';
import {
  LlmError,
  type ChatMessage,
  type ChatRequest,
  type FinishReason,
  type LlmClient,
  type LlmEvent,
  type ToolCall,
  type Usage,
} from './types.js';

/** The subset of one streamed `chat.completions` chunk we rely on. Everything else is ignored. */
const ChunkSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullish(),
            tool_calls: z
              .array(
                z.object({
                  index: z.number().int(),
                  id: z.string().nullish(),
                  function: z
                    .object({ name: z.string().nullish(), arguments: z.string().nullish() })
                    .nullish(),
                }),
              )
              .nullish(),
          })
          .nullish(),
        finish_reason: z.string().nullish(),
      }),
    )
    .optional(),
  usage: z.object({ prompt_tokens: z.number(), completion_tokens: z.number() }).nullish(),
});

export interface OpenAICompatibleOptions extends LlmConfig {
  /** Injectable for tests. Defaults to the global fetch. */
  fetch?: typeof fetch;
  /** Ask the provider to report token usage in the final chunk. Some gateways reject this. */
  includeUsage?: boolean;
}

function toWireMessage(message: ChatMessage): Record<string, unknown> {
  switch (message.role) {
    case 'tool':
      return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    case 'assistant':
      return {
        role: 'assistant',
        content: message.content,
        ...(message.toolCalls && message.toolCalls.length > 0
          ? {
              tool_calls: message.toolCalls.map((call) => ({
                id: call.id,
                type: 'function',
                function: { name: call.name, arguments: call.arguments },
              })),
            }
          : {}),
      };
    default:
      return { role: message.role, content: message.content };
  }
}

function toFinishReason(raw: string): FinishReason {
  switch (raw) {
    case 'stop':
    case 'tool_calls':
    case 'length':
    case 'content_filter':
      return raw;
    default:
      return 'unknown';
  }
}

interface PendingToolCall {
  id: string;
  name: string;
  arguments: string;
}

export function createOpenAICompatibleClient(options: OpenAICompatibleOptions): LlmClient {
  const baseUrl = options.baseUrl.replace(/\/+$/, '');
  const fetchFn = options.fetch ?? fetch;
  const includeUsage = options.includeUsage ?? true;

  const redact = (text: string) =>
    options.apiKey ? text.replaceAll(options.apiKey, '[redacted]') : text;

  return {
    async *stream(request: ChatRequest, signal?: AbortSignal): AsyncGenerator<LlmEvent> {
      const body = {
        model: options.model,
        stream: true,
        ...(includeUsage ? { stream_options: { include_usage: true } } : {}),
        messages: request.messages.map(toWireMessage),
        ...(request.tools && request.tools.length > 0
          ? {
              tools: request.tools.map((tool) => ({
                type: 'function',
                function: {
                  name: tool.name,
                  description: tool.description,
                  parameters: tool.parameters,
                },
              })),
            }
          : {}),
        ...(request.temperature !== undefined ? { temperature: request.temperature } : {}),
        ...(request.maxTokens !== undefined ? { max_tokens: request.maxTokens } : {}),
      };

      const response = await fetchFn(`${baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      });

      if (!response.ok) {
        const detail = redact((await response.text()).slice(0, 500));
        throw new LlmError(
          `LLM request failed with status ${response.status}: ${detail}`,
          response.status,
        );
      }
      if (!response.body) throw new LlmError('LLM response has no body', response.status);

      const pending = new Map<number, PendingToolCall>();
      let finishReason: FinishReason = 'unknown';
      let usage: Usage | null = null;

      for await (const data of parseSse(response.body)) {
        if (data === '[DONE]') break;

        let json: unknown;
        try {
          json = JSON.parse(data);
        } catch {
          throw new LlmError('LLM stream contained invalid JSON', null);
        }
        const parsed = ChunkSchema.safeParse(json);
        if (!parsed.success) throw new LlmError('LLM stream chunk has an unexpected shape', null);

        if (parsed.data.usage) {
          usage = {
            promptTokens: parsed.data.usage.prompt_tokens,
            completionTokens: parsed.data.usage.completion_tokens,
          };
        }

        for (const choice of parsed.data.choices ?? []) {
          const text = choice.delta?.content;
          if (text) yield { type: 'text-delta', text };

          // Tool calls arrive as fragments keyed by index: id and name first, then the
          // arguments JSON in pieces. Accumulate them and emit once the stream ends.
          for (const fragment of choice.delta?.tool_calls ?? []) {
            const entry = pending.get(fragment.index) ?? { id: '', name: '', arguments: '' };
            if (fragment.id) entry.id = fragment.id;
            if (fragment.function?.name) entry.name += fragment.function.name;
            if (fragment.function?.arguments) entry.arguments += fragment.function.arguments;
            pending.set(fragment.index, entry);
          }

          if (choice.finish_reason) finishReason = toFinishReason(choice.finish_reason);
        }
      }

      for (const [, entry] of [...pending.entries()].sort((a, b) => a[0] - b[0])) {
        const call: ToolCall = { id: entry.id, name: entry.name, arguments: entry.arguments };
        yield { type: 'tool-call', call };
      }
      yield { type: 'finish', reason: finishReason, usage };
    },
  };
}
