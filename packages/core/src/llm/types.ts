/** Provider-neutral chat types. Adapters translate these to and from a vendor wire format. */

export interface ToolCall {
  id: string;
  name: string;
  /** Raw JSON text exactly as produced by the model; parse and validate it before use. */
  arguments: string;
}

export type ChatMessage =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; toolCalls?: ToolCall[] }
  | { role: 'tool'; toolCallId: string; content: string };

export interface ToolSpec {
  name: string;
  description: string;
  /** JSON Schema describing the tool's arguments. */
  parameters: Record<string, unknown>;
}

export interface ChatRequest {
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
}

export type FinishReason = 'stop' | 'tool_calls' | 'length' | 'content_filter' | 'unknown';

export interface Usage {
  promptTokens: number;
  completionTokens: number;
}

export type LlmEvent =
  | { type: 'text-delta'; text: string }
  | { type: 'tool-call'; call: ToolCall }
  | { type: 'finish'; reason: FinishReason; usage: Usage | null };

export interface LlmClient {
  /** Stream a completion. Aborting `signal` cancels the underlying network request. */
  stream(request: ChatRequest, signal?: AbortSignal): AsyncIterable<LlmEvent>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    /** HTTP status when the failure came from the provider, otherwise null. */
    readonly status: number | null,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
