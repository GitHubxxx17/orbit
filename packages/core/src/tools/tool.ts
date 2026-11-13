import type { OrbitEvent, RiskLevel } from '@orbit/protocol';
import type { z } from 'zod';

export interface FileChange {
  /** Workspace-relative path, forward slashes. */
  path: string;
  /** The text before the write; null when the file did not exist. */
  before: string | null;
  after: string;
}

export interface ToolContext {
  /** Aborted when the run is cancelled; long-running tools should honor it. */
  signal: AbortSignal;
  /**
   * A tool that really changed a file reports it here, so the change is recorded and can be undone.
   * Absent when nobody records (for example in a tool's own unit tests).
   */
  recordChange?: (change: FileChange) => void;
  /** The id of the tool call being run. */
  callId?: string;
  /** The events of the current run so far; for tools that reason about what happened (report). */
  events?: () => OrbitEvent[];
}

/** A tool as the runtime sees it: arguments are `unknown` until the tool validates them itself. */
export interface Tool {
  name: string;
  description: string;
  risk: RiskLevel;
  /** The single source of truth for arguments; the JSON Schema sent to the model is derived. */
  schema: z.ZodType;
  /** Validates `rawArgs` against `schema`, then runs. Throws on invalid arguments or failure. */
  run(rawArgs: unknown, context: ToolContext): Promise<string>;
  /**
   * Describe what `run` would change without changing anything (for a write: a diff). Shown to the
   * user when the call needs approval. Throws on invalid arguments, like `run`.
   */
  preview?(rawArgs: unknown, context: ToolContext): Promise<string>;
}

export interface ToolDefinition<S extends z.ZodType> {
  name: string;
  description: string;
  risk: RiskLevel;
  schema: S;
  execute(args: z.infer<S>, context: ToolContext): Promise<string>;
  preview?(args: z.infer<S>, context: ToolContext): Promise<string>;
}

/** Define a tool whose `execute` receives arguments already parsed and typed by its schema. */
export function defineTool<S extends z.ZodType>(definition: ToolDefinition<S>): Tool {
  const { preview } = definition;
  return {
    name: definition.name,
    description: definition.description,
    risk: definition.risk,
    schema: definition.schema,
    // async so that invalid arguments surface as a rejected promise, never a synchronous throw.
    run: async (rawArgs, context) => definition.execute(definition.schema.parse(rawArgs), context),
    ...(preview
      ? {
          preview: async (rawArgs: unknown, context: ToolContext) =>
            preview(definition.schema.parse(rawArgs), context),
        }
      : {}),
  };
}
