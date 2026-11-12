import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';

/** Thrown for any path the sandbox refuses. The message is safe to show to the model. */
export class SandboxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SandboxError';
  }
}

/** Directories that are noise for an agent and sometimes hold secrets. */
export const IGNORED_DIRS: ReadonlySet<string> = new Set([
  '.git',
  'node_modules',
  'dist',
  '.turbo',
  'coverage',
]);

const SENSITIVE_NAME = [
  /^\.env(\..+)?$/,
  /^\.npmrc$/,
  /^\.netrc$/,
  /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/,
  /\.(pem|key|p12|pfx)$/,
];
const ENV_TEMPLATE = /^\.env\.(example|sample|template)$/;

function isInside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return (
    relative === '' ||
    (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))
  );
}

/** A file name that usually holds credentials. Templates such as `.env.example` are allowed. */
export function isSensitiveName(name: string): boolean {
  if (ENV_TEMPLATE.test(name)) return false;
  return SENSITIVE_NAME.some((pattern) => pattern.test(name));
}

/**
 * Confines file access to one workspace directory. All checks run on real paths (symlinks
 * resolved), so a link inside the workspace cannot lead outside it.
 */
export class Sandbox {
  private constructor(readonly root: string) {}

  static async create(workspace: string): Promise<Sandbox> {
    return new Sandbox(await realpath(workspace));
  }

  /** Resolve a model-supplied path to a real absolute path inside the workspace, or throw. */
  async resolve(userPath: string): Promise<string> {
    if (userPath.includes('\0')) throw new SandboxError('path contains a NUL byte');

    const candidate = path.resolve(this.root, userPath);
    if (!isInside(this.root, candidate)) throw new SandboxError('path is outside the workspace');

    let real: string;
    try {
      real = await realpath(candidate);
    } catch {
      throw new SandboxError(`no such file or directory: ${userPath}`);
    }
    if (!isInside(this.root, real)) throw new SandboxError('path is outside the workspace');
    if (this.isDenied(real)) throw new SandboxError('access to this path is not allowed');
    return real;
  }

  /**
   * Resolve a path the agent wants to WRITE. The file may not exist yet, so the nearest existing
   * ancestor is resolved with `realpath` (catching symlinked folders) and the rest is appended.
   * Writing through a symbolic link is refused, since it could land outside the workspace.
   */
  async resolveWritable(userPath: string): Promise<string> {
    if (userPath.includes('\0')) throw new SandboxError('path contains a NUL byte');

    const candidate = path.resolve(this.root, userPath);
    if (!isInside(this.root, candidate)) throw new SandboxError('path is outside the workspace');

    let existing = candidate;
    const missing: string[] = [];
    let real: string;
    for (;;) {
      try {
        real = await realpath(existing);
        break;
      } catch {
        const parent = path.dirname(existing);
        if (parent === existing) throw new SandboxError('path is outside the workspace');
        missing.unshift(path.basename(existing));
        existing = parent;
      }
    }
    if (!isInside(this.root, real)) throw new SandboxError('path is outside the workspace');

    const target = path.join(real, ...missing);
    if (target === this.root) throw new SandboxError('the workspace root is not a file');
    if (this.isDenied(target)) throw new SandboxError('access to this path is not allowed');

    // A dangling link would make a write create its (possibly outside) target.
    const info = await lstat(target).catch(() => null);
    if (info?.isSymbolicLink()) throw new SandboxError('refusing to write through a symbolic link');
    return target;
  }

  /** True for paths the agent must never read: ignored directories and credential files. */
  isDenied(absolutePath: string): boolean {
    const segments = path.relative(this.root, absolutePath).split(path.sep).filter(Boolean);
    const last = segments.at(-1);
    return (
      segments.some((segment) => IGNORED_DIRS.has(segment)) ||
      (last !== undefined && isSensitiveName(last))
    );
  }

  /** Workspace-relative display path with forward slashes. */
  relative(absolutePath: string): string {
    return path.relative(this.root, absolutePath).split(path.sep).join('/') || '.';
  }
}
