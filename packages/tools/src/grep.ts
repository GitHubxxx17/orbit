import { readdir, readFile, stat } from 'node:fs/promises';

import { defineTool, type Tool } from '@orbit/core';
import { z } from 'zod';

import { clip } from './output.js';
import { looksBinary, MAX_FILE_BYTES } from './read-file.js';
import type { Sandbox } from './sandbox.js';
import { SandboxError } from './sandbox.js';

const MAX_MATCHES = 100;
const MAX_FILES = 2_000;
/** Longer lines (minified bundles) are skipped: they are useless to read and slow to match. */
const MAX_LINE_CHARS = 2_000;
const MAX_SHOWN_LINE_CHARS = 200;

/** Walk a directory in a stable order, skipping anything the sandbox denies. */
async function* walk(sandbox: Sandbox, directory: string): AsyncGenerator<string> {
  const entries = (await readdir(directory, { withFileTypes: true })).sort((a, b) =>
    a.name.localeCompare(b.name),
  );
  for (const entry of entries) {
    const full = `${directory}/${entry.name}`;
    if (sandbox.isDenied(full)) continue;
    // Symbolic links are not followed: they could point outside the workspace or loop.
    if (entry.isDirectory()) yield* walk(sandbox, full);
    else if (entry.isFile()) yield full;
  }
}

export function grepTool(sandbox: Sandbox): Tool {
  return defineTool({
    name: 'grep',
    description:
      'Search the workspace for lines matching a regular expression (JavaScript syntax). ' +
      'Returns path:line: text for each match.',
    risk: 'read',
    idempotent: true,
    schema: z.object({
      pattern: z.string().min(1).max(200).describe('Regular expression to search for.'),
      path: z.string().default('.').describe('File or directory to search, relative to the root.'),
      ignoreCase: z.boolean().default(false),
    }),
    execute: async ({ pattern, path, ignoreCase }) => {
      let regex: RegExp;
      try {
        regex = new RegExp(pattern, ignoreCase ? 'i' : '');
      } catch (error) {
        throw new SandboxError(
          `invalid regular expression: ${error instanceof Error ? error.message : String(error)}`,
        );
      }

      const target = await sandbox.resolve(path);
      const files = (await stat(target)).isDirectory() ? walk(sandbox, target) : [target];

      const matches: string[] = [];
      let scanned = 0;
      let stoppedEarly = false;

      search: for await (const file of files) {
        if (++scanned > MAX_FILES) {
          stoppedEarly = true;
          break;
        }
        if ((await stat(file)).size > MAX_FILE_BYTES) continue;
        const buffer = await readFile(file);
        if (looksBinary(buffer)) continue;

        const lines = buffer.toString('utf8').split('\n');
        for (const [index, line] of lines.entries()) {
          if (line.length > MAX_LINE_CHARS || !regex.test(line)) continue;
          matches.push(
            `${sandbox.relative(file)}:${index + 1}: ${line.slice(0, MAX_SHOWN_LINE_CHARS)}`,
          );
          if (matches.length >= MAX_MATCHES) {
            stoppedEarly = true;
            break search;
          }
        }
      }

      if (matches.length === 0)
        return stoppedEarly ? 'no matches in the files scanned' : 'no matches';
      const note = stoppedEarly ? `\n[stopped early; results are incomplete]` : '';
      return clip(matches.join('\n') + note);
    },
  });
}
