import { readdir, stat } from 'node:fs/promises';

import { defineTool, type Tool } from '@orbit/core';
import { z } from 'zod';

import { clip } from './output.js';
import type { Sandbox } from './sandbox.js';
import { SandboxError } from './sandbox.js';

const MAX_ENTRIES = 200;

export function listDirTool(sandbox: Sandbox): Tool {
  return defineTool({
    name: 'list_dir',
    description:
      'List the files and directories directly inside a directory of the workspace. ' +
      'Hidden noise such as node_modules and .git, and credential files, are omitted.',
    risk: 'read',
    schema: z.object({
      path: z.string().default('.').describe('Directory relative to the workspace root.'),
    }),
    execute: async ({ path }) => {
      const directory = await sandbox.resolve(path);
      if (!(await stat(directory)).isDirectory()) {
        throw new SandboxError(`not a directory: ${path}`);
      }

      const entries = (await readdir(directory, { withFileTypes: true }))
        .filter((entry) => !sandbox.isDenied(`${directory}/${entry.name}`))
        .sort((a, b) => a.name.localeCompare(b.name));

      const lines = entries.slice(0, MAX_ENTRIES).map((entry) => {
        const kind = entry.isDirectory() ? 'dir ' : entry.isSymbolicLink() ? 'link' : 'file';
        return `${kind} ${entry.name}`;
      });
      if (entries.length > MAX_ENTRIES) {
        lines.push(`[${entries.length - MAX_ENTRIES} more entries not shown]`);
      }
      return clip(lines.length > 0 ? lines.join('\n') : '(empty directory)');
    },
  });
}
