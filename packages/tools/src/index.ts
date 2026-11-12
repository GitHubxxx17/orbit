import type { Tool } from '@orbit/core';

import { grepTool } from './grep.js';
import { listDirTool } from './list-dir.js';
import { readFileTool } from './read-file.js';
import { Sandbox } from './sandbox.js';
import { writeFileTool } from './write-file.js';

export { clip, MAX_OUTPUT_CHARS } from './output.js';
export { Sandbox, SandboxError, isSensitiveName } from './sandbox.js';

/** The read-only tool set, confined to one workspace directory. */
export async function createReadOnlyTools(workspace: string): Promise<Tool[]> {
  const sandbox = await Sandbox.create(workspace);
  return [listDirTool(sandbox), readFileTool(sandbox), grepTool(sandbox)];
}

/**
 * Read-only tools plus `write_file`. The write tool has `risk: 'write'`, so a policy decides
 * whether it runs, asks the user, or is refused.
 */
export async function createTools(workspace: string): Promise<Tool[]> {
  const sandbox = await Sandbox.create(workspace);
  return [listDirTool(sandbox), readFileTool(sandbox), grepTool(sandbox), writeFileTool(sandbox)];
}
