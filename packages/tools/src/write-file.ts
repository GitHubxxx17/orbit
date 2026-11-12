import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import { defineTool, type Tool } from '@orbit/core';
import { createTwoFilesPatch } from 'diff';
import { z } from 'zod';

import { clip } from './output.js';
import { looksBinary, MAX_FILE_BYTES } from './read-file.js';
import type { Sandbox } from './sandbox.js';
import { SandboxError } from './sandbox.js';

export const MAX_WRITE_CHARS = 200_000;

/** The file's current text, or null when it does not exist yet. */
async function currentText(file: string): Promise<string | null> {
  let info;
  try {
    info = await stat(file);
  } catch {
    return null;
  }
  if (!info.isFile()) throw new SandboxError('the path is not a file');
  if (info.size > MAX_FILE_BYTES)
    throw new SandboxError('the existing file is too large to replace');
  const buffer = await readFile(file);
  if (looksBinary(buffer)) throw new SandboxError('the existing file is binary');
  return buffer.toString('utf8');
}

export function writeFileTool(sandbox: Sandbox): Tool {
  return defineTool({
    name: 'write_file',
    description:
      'Create a file or replace the whole content of an existing one, inside the workspace. ' +
      'The user reviews the change as a diff and may reject it, so always send the COMPLETE new ' +
      'content, not a fragment.',
    risk: 'write',
    schema: z.object({
      path: z.string().min(1).describe('File path relative to the workspace root.'),
      content: z.string().max(MAX_WRITE_CHARS).describe('The complete new content of the file.'),
    }),
    preview: async ({ path: userPath, content }) => {
      const file = await sandbox.resolveWritable(userPath);
      const before = await currentText(file);
      if (before === content) return '(没有变化)';
      const name = sandbox.relative(file);
      return clip(
        createTwoFilesPatch(
          before === null ? '/dev/null' : `a/${name}`,
          `b/${name}`,
          before ?? '',
          content,
          '',
          '',
          { context: 3 },
        ),
      );
    },
    execute: async ({ path: userPath, content }) => {
      const file = await sandbox.resolveWritable(userPath);
      const existed = (await currentText(file)) !== null;
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, 'utf8');
      return `${existed ? 'updated' : 'created'} ${sandbox.relative(file)} (${Buffer.byteLength(content)} bytes)`;
    },
  });
}
