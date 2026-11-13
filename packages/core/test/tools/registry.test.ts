import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import { ToolRegistry } from '../../src/tools/registry.js';
import { defineTool } from '../../src/tools/tool.js';

const tool = defineTool({
  name: 'add',
  description: 'Add two numbers.',
  risk: 'read',
  schema: z.object({ a: z.number(), b: z.number() }),
  execute: async ({ a, b }) => String(a + b),
});

describe('ToolRegistry', () => {
  it('rejects duplicate names', () => {
    const registry = new ToolRegistry().register(tool);
    expect(() => registry.register(tool)).toThrow('tool already registered: add');
  });

  it('looks tools up by name', () => {
    const registry = new ToolRegistry().register(tool);
    expect(registry.get('add')).toBe(tool);
    expect(registry.get('missing')).toBeUndefined();
  });

  it('marks fields with defaults as optional in the schema sent to the model', () => {
    const withDefault = defineTool({
      name: 'paged',
      description: 'Paged read.',
      risk: 'read',
      schema: z.object({ path: z.string(), limit: z.number().default(10) }),
      execute: async () => '',
    });
    const [spec] = new ToolRegistry().register(withDefault).specs();
    expect(spec?.parameters).toMatchObject({ required: ['path'] });
  });

  it('sends a ready-made JSON Schema as is', () => {
    const parameters = { type: 'object', properties: { q: { type: 'string' } }, required: ['q'] };
    const external = {
      name: 'ext',
      description: 'From elsewhere.',
      risk: 'write' as const,
      schema: z.record(z.string(), z.unknown()),
      jsonSchema: parameters,
      run: async () => '',
    };
    const [spec] = new ToolRegistry().register(external).specs();
    expect(spec?.parameters).toEqual(parameters);
  });
});

describe('defineTool', () => {
  it('validates arguments before executing', async () => {
    await expect(tool.run({ a: 1, b: 2 }, { signal: new AbortController().signal })).resolves.toBe(
      '3',
    );
    await expect(
      tool.run({ a: 'x', b: 2 }, { signal: new AbortController().signal }),
    ).rejects.toThrow();
  });
});
