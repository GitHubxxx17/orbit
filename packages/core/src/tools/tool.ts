import type { RiskLevel } from '@orbit/protocol';
import type { z } from 'zod';

export interface ToolContext {
  /** Aborted when the run is cancelled; long-running tools should honor it. */
  signal: AbortSignal;
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
}

export interface ToolDefinition<S extends z.ZodType> {
  name: string;
  description: string;
  risk: RiskLevel;
  schema: S;
  execute(args: z.infer<S>, context: ToolContext): Promise<string>;
}

/** Define a tool whose `execute` receives arguments already parsed and typed by its schema. */
export function defineTool<S extends z.ZodType>(definition: ToolDefinition<S>): Tool {
  return {
    name: definition.name,
    description: definition.description,
    risk: definition.risk,
    schema: definition.schema,
    // async so that invalid arguments surface as a rejected promise, never a synchronous throw.
    run: async (rawArgs, context) => definition.execute(definition.schema.parse(rawArgs), context),
  };
}
