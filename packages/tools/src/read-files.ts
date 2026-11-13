import { defineTool, type Tool } from '@orbit/core';
import { z } from 'zod';

import { readLines } from './read-file.js';
import type { Sandbox } from './sandbox.js';

/** Most files one call may ask for. */
export const MAX_BATCH_FILES = 20;
/** Lines per file when the call does not say. Smaller than read_file's: there are several. */
const DEFAULT_LIMIT = 150;
/** Upper bound on what one call puts into the model's context, across all its files. */
export const MAX_BATCH_CHARS = 40_000;

/**
 * Read several text files in one call. Every round trip to the model sends the whole conversation
 * again, so reading ten files in one call costs far less than ten calls of one file each. A file
 * that cannot be read (denied, missing, binary) is reported in its place and does not fail the rest.
 */
export function readFilesTool(sandbox: Sandbox): Tool {
  return defineTool({
    name: 'read_files',
    description:
      'Read several text files from the workspace in one call, each with line numbers. ' +
      `Up to ${MAX_BATCH_FILES} files; ask for every file you need at once instead of one call ` +
      'per file. Use offset and limit per file to read only the lines you need. If the total is ' +
      'too large, the files that did not fit are listed so you can ask for them again.',
    risk: 'read',
    idempotent: true,
    schema: z.object({
      files: z
        .array(
          z.object({
            path: z.string().min(1).describe('File path relative to the workspace root.'),
            offset: z.number().int().min(1).default(1).describe('First line, 1-based.'),
            limit: z
              .number()
              .int()
              .min(1)
              .max(500)
              .default(DEFAULT_LIMIT)
              .describe(`Maximum lines for this file. Default ${DEFAULT_LIMIT}.`),
          }),
        )
        .min(1)
        .max(MAX_BATCH_FILES),
    }),
    execute: async ({ files }) => {
      const sections: string[] = [];
      const skipped: string[] = [];
      let used = 0;

      for (const { path, offset, limit } of files) {
        if (used >= MAX_BATCH_CHARS) {
          skipped.push(path);
          continue;
        }
        let body: string;
        try {
          body = await readLines(sandbox, path, offset, limit);
        } catch (error) {
          body = `Error: ${error instanceof Error ? error.message : String(error)}`;
        }
        // Cut the one file that crosses the limit; later files are not started.
        const room = MAX_BATCH_CHARS - used;
        const shown =
          body.length > room
            ? `${body.slice(0, room)}\n[file cut: ${body.length - room} more characters]`
            : body;
        const section = `=== ${path} ===\n${shown}`;
        sections.push(section);
        used += section.length;
      }

      if (skipped.length > 0) {
        sections.push(
          `[not shown, output limit reached: ${skipped.join(', ')}; ask for them again in a new call]`,
        );
      }
      return sections.join('\n\n');
    },
  });
}
