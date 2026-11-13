import { z } from 'zod';

import type { ToolSpec } from '../llm/types.js';
import type { Tool } from './tool.js';

export class ToolRegistry {
  private readonly tools = new Map<string, Tool>();

  register(tool: Tool): this {
    if (this.tools.has(tool.name)) throw new Error(`tool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
    return this;
  }

  get(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  /** Every registered tool, for listing in a settings page. */
  list(): Tool[] {
    return [...this.tools.values()];
  }

  /**
   * A registry holding only the named tools (names that are not registered are ignored). It
   * narrows what a run may call; it can never add a tool, so it can not widen what is allowed.
   */
  pick(names: readonly string[]): ToolRegistry {
    const picked = new ToolRegistry();
    for (const name of names) {
      const tool = this.tools.get(name);
      if (tool && !picked.tools.has(name)) picked.register(tool);
    }
    return picked;
  }

  /** The tool list sent to the model, with JSON Schema derived from each zod schema. */
  specs(): ToolSpec[] {
    return [...this.tools.values()].map((tool) => {
      if (tool.jsonSchema) {
        return { name: tool.name, description: tool.description, parameters: tool.jsonSchema };
      }
      const { $schema: _ignored, ...parameters } = z.toJSONSchema(tool.schema, {
        // Describe what the model must SEND: fields with defaults are optional on input.
        io: 'input',
      }) as Record<string, unknown>;
      return { name: tool.name, description: tool.description, parameters };
    });
  }
}
