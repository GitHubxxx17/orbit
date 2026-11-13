import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
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
    execute: async ({ path: userPath, content }, context) => {
      const file = await sandbox.resolveWritable(userPath);
      const before = await currentText(file);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, content, 'utf8');
      // Tell the runtime what changed, with both versions, so the change can be undone later.
      context.recordChange?.({ path: sandbox.relative(file), before, after: content });
      return `${before !== null ? 'updated' : 'created'} ${sandbox.relative(file)} (${Buffer.byteLength(content)} bytes)`;
    },
  });
}

export class RollbackConflict extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RollbackConflict';
  }
}

/**
 * Undo one recorded write: put `before` back, or remove the file if it did not exist. Refuses
 * (RollbackConflict) when the file is no longer exactly what the agent wrote, because then the
 * user or another run has changed it since and undoing would destroy that work.
 */
export async function rollbackWrite(
  sandbox: Sandbox,
  change: { path: string; before: string | null; after: string },
): Promise<void> {
  const file = await sandbox.resolveWritable(change.path);
  const now = await currentText(file);
  if (now !== change.after) {
    throw new RollbackConflict(
      now === null
        ? `${change.path} no longer exists, so there is nothing to restore`
        : `${change.path} was changed after the agent wrote it; undoing would lose those changes`,
    );
  }
  if (change.before === null) await rm(file);
  else await writeFile(file, change.before, 'utf8');
}
