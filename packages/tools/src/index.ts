import type { Tool } from '@orbit/core';

import { grepTool } from './grep.js';
import { listDirTool } from './list-dir.js';
import { readFileTool } from './read-file.js';
import { Sandbox } from './sandbox.js';

export { clip, MAX_OUTPUT_CHARS } from './output.js';
export { Sandbox, SandboxError, isSensitiveName } from './sandbox.js';

/** The read-only tool set, confined to one workspace directory. */
export async function createReadOnlyTools(workspace: string): Promise<Tool[]> {
  const sandbox = await Sandbox.create(workspace);
  return [listDirTool(sandbox), readFileTool(sandbox), grepTool(sandbox)];
}
