import { readdir, stat } from 'node:fs/promises';

import { defineTool, type Tool } from '@orbit/core';
import { z } from 'zod';

import { clip } from './output.js';
import type { Sandbox } from './sandbox.js';
import { SandboxError } from './sandbox.js';

const MAX_ENTRIES = 200;
const MAX_DEPTH = 4;

export function listDirTool(sandbox: Sandbox): Tool {
  return defineTool({
    name: 'list_dir',
    description:
      'List the files and directories of a directory of the workspace. By default only the ' +
      `entries directly inside it; set depth (up to ${MAX_DEPTH}) to see the tree below it in one ` +
      'call instead of listing each directory separately. ' +
      'Hidden noise such as node_modules and .git, and credential files, are omitted.',
    risk: 'read',
    idempotent: true,
    schema: z.object({
      path: z.string().default('.').describe('Directory relative to the workspace root.'),
      depth: z
        .number()
        .int()
        .min(1)
        .max(MAX_DEPTH)
        .default(1)
        .describe('How many levels to show. 1 is just this directory.'),
    }),
    execute: async ({ path, depth }) => {
      const directory = await sandbox.resolve(path);
      if (!(await stat(directory)).isDirectory()) {
        throw new SandboxError(`not a directory: ${path}`);
      }

      const lines: string[] = [];
      let total = 0;

      // Depth first, in name order, indented two spaces per level. Links are shown, not followed.
      const visit = async (dir: string, level: number): Promise<void> => {
        const entries = (await readdir(dir, { withFileTypes: true }))
          .filter((entry) => !sandbox.isDenied(`${dir}/${entry.name}`))
          .sort((a, b) => a.name.localeCompare(b.name));
        for (const entry of entries) {
          total += 1;
          if (total > MAX_ENTRIES) continue;
          const kind = entry.isDirectory() ? 'dir ' : entry.isSymbolicLink() ? 'link' : 'file';
          lines.push(`${'  '.repeat(level)}${kind} ${entry.name}`);
          if (entry.isDirectory() && level + 1 < depth) {
            await visit(`${dir}/${entry.name}`, level + 1);
          }
        }
      };
      await visit(directory, 0);

      if (total > MAX_ENTRIES) lines.push(`[${total - MAX_ENTRIES} more entries not shown]`);
      return clip(lines.length > 0 ? lines.join('\n') : '(empty directory)');
    },
  });
}
