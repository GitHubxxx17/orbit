import type { Tool } from '@orbit/core';
import type { McpToolInfo } from '@orbit/protocol';
import { z } from 'zod';

/** What an MCP server tells us about one of its tools (only the fields we use). */
export interface McpToolDefinition {
  name: string;
  description?: string | undefined;
  inputSchema: Record<string, unknown>;
}

/** The call, as the SDK client performs it. A seam so the conversion can be tested alone. */
export type CallMcpTool = (
  name: string,
  args: Record<string, unknown>,
  options: { signal: AbortSignal; timeoutMs: number },
) => Promise<McpCallResult>;

export interface McpCallResult {
  isError?: boolean | undefined;
  content?: readonly unknown[] | undefined;
  structuredContent?: Record<string, unknown> | undefined;
}

/** Function-calling APIs accept names of letters, digits, `_` and `-`, at most 64 characters. */
const MAX_NAME = 64;
const MAX_DESCRIPTION = 500;
const MAX_SCHEMA_CHARS = 20_000;
export const MAX_RESULT_CHARS = 20_000;
const MAX_PREVIEW_CHARS = 4_000;

const Args = z.record(z.string(), z.unknown());

const clip = (text: string, max: number) =>
  text.length > max ? `${text.slice(0, max)}\n…(已截断，共 ${text.length} 个字符)` : text;

/**
 * A tool description comes from the server and is sent to the model, so it is untrusted text that
 * could carry instructions. Strip control characters and cap the length; the system prompt still
 * tells the model to treat tool output as data.
 */
function cleanDescription(text: string | undefined): string {
  const flat = [...(text ?? '')]
    .map((char) => (char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127 ? ' ' : char))
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  return flat.length > MAX_DESCRIPTION ? `${flat.slice(0, MAX_DESCRIPTION)}…` : flat;
}

/** The name the model sees; null when the tool cannot be given a valid one. */
export function orbitToolName(serverId: string, toolName: string): string | null {
  const name = `mcp__${serverId}__${toolName.replace(/[^a-zA-Z0-9_-]/g, '_')}`;
  return name.length <= MAX_NAME ? name : null;
}

/** Turn a tool result into text for the model. Binary content is named, never inlined. */
export function renderResult(result: McpCallResult): string {
  const parts: string[] = [];
  for (const block of result.content ?? []) {
    const item = block as { type?: unknown; text?: unknown; uri?: unknown; resource?: unknown };
    if (item.type === 'text' && typeof item.text === 'string') parts.push(item.text);
    else if (item.type === 'image') parts.push('[图片，未显示]');
    else if (item.type === 'audio') parts.push('[音频，未显示]');
    else if (item.type === 'resource_link' && typeof item.uri === 'string') {
      parts.push(`[资源链接：${item.uri}]`);
    } else if (item.type === 'resource') {
      const inner = item.resource as { text?: unknown } | undefined;
      parts.push(typeof inner?.text === 'string' ? inner.text : '[资源，未显示]');
    }
  }
  if (parts.length === 0 && result.structuredContent) {
    parts.push(JSON.stringify(result.structuredContent));
  }
  return clip(parts.join('\n'), MAX_RESULT_CHARS);
}

export type Converted = { ok: true; tool: Tool; info: McpToolInfo } | { ok: false; reason: string };

/**
 * Wrap one MCP tool as an Orbit tool. Its risk is `write` unless the user listed it as read-only in
 * the config: a server's own claim ("readOnlyHint") is not trusted, because the server is exactly
 * what we do not trust. The approval preview shows the arguments, since there is no diff.
 */
export function convertTool(
  serverId: string,
  definition: McpToolDefinition,
  call: CallMcpTool,
  options: { readOnly: boolean; timeoutMs: number },
): Converted {
  const name = orbitToolName(serverId, definition.name);
  if (!name) return { ok: false, reason: `${definition.name}: name too long` };
  const schemaJson = JSON.stringify(definition.inputSchema);
  if (schemaJson.length > MAX_SCHEMA_CHARS) {
    return { ok: false, reason: `${definition.name}: input schema too large` };
  }
  const { $schema: _ignored, ...parameters } = definition.inputSchema;
  const risk = options.readOnly ? 'read' : 'write';
  const description = `[MCP ${serverId}] ${cleanDescription(definition.description)}`.trim();

  const tool: Tool = {
    name,
    description,
    risk,
    schema: Args,
    jsonSchema: { type: 'object', ...parameters },
    preview: async (rawArgs) =>
      clip(
        `MCP 服务器 ${serverId} 将调用 ${definition.name}\n${JSON.stringify(Args.parse(rawArgs), null, 2)}`,
        MAX_PREVIEW_CHARS,
      ),
    run: async (rawArgs, { signal }) => {
      const result = await call(definition.name, Args.parse(rawArgs), {
        signal,
        timeoutMs: options.timeoutMs,
      });
      const text = renderResult(result);
      // An error reported by the server is a failed call, so the model is told it failed.
      if (result.isError) throw new Error(text || 'the MCP tool reported an error');
      return text;
    },
  };
  return { ok: true, tool, info: { name, risk, description } };
}
