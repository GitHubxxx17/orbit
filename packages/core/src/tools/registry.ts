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
