import { readFile, stat } from 'node:fs/promises';

import { defineTool, type Tool } from '@orbit/core';
import { z } from 'zod';

import { clip } from './output.js';
import type { Sandbox } from './sandbox.js';
import { SandboxError } from './sandbox.js';

export const MAX_FILE_BYTES = 1_000_000;
const BINARY_SNIFF_BYTES = 8_000;

/** A NUL byte near the start is the usual signal that a file is not text. */
export function looksBinary(buffer: Buffer): boolean {
  return buffer.subarray(0, BINARY_SNIFF_BYTES).includes(0);
}

export function readFileTool(sandbox: Sandbox): Tool {
  return defineTool({
    name: 'read_file',
    description:
      'Read a text file from the workspace, returned with line numbers. ' +
      'Use offset and limit to page through long files. To read several files, prefer ' +
      'read_files: one call instead of one per file.',
    risk: 'read',
    idempotent: true,
    schema: z.object({
      path: z.string().min(1).describe('File path relative to the workspace root.'),
      offset: z.number().int().min(1).default(1).describe('First line to return, 1-based.'),
      limit: z.number().int().min(1).max(500).default(200).describe('Maximum lines to return.'),
    }),
    execute: async ({ path, offset, limit }) => clip(await readLines(sandbox, path, offset, limit)),
  });
}

/**
 * The lines `offset` to `offset + limit - 1` of a text file, numbered, with a note saying where to
 * continue when there is more. Throws a `SandboxError` for a path the sandbox refuses, a directory,
 * a file that is too large or binary, or an offset past the end. Not clipped: the caller decides
 * how much of the result to pass on.
 */
export async function readLines(
  sandbox: Sandbox,
  path: string,
  offset: number,
  limit: number,
): Promise<string> {
  const file = await sandbox.resolve(path);
  const info = await stat(file);
  if (!info.isFile()) throw new SandboxError(`not a file: ${path}`);
  if (info.size > MAX_FILE_BYTES) {
    throw new SandboxError(`file is too large (${info.size} bytes); search it with grep instead`);
  }

  const buffer = await readFile(file);
  if (looksBinary(buffer)) throw new SandboxError('binary files cannot be read');

  const lines = buffer.toString('utf8').split('\n');
  if (lines.at(-1) === '') lines.pop(); // trailing newline is not an extra line
  if (offset > Math.max(lines.length, 1)) {
    throw new SandboxError(`offset ${offset} is past the end of the file (${lines.length} lines)`);
  }

  const end = Math.min(offset - 1 + limit, lines.length);
  const body = lines
    .slice(offset - 1, end)
    .map((line, index) => `${offset + index}\t${line}`)
    .join('\n');
  const footer =
    end < lines.length
      ? `\n[showing lines ${offset}-${end} of ${lines.length}; call again with offset=${end + 1}]`
      : '';
  return body + footer;
}
