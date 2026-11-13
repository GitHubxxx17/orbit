import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { ToolRegistry, type Tool } from '@orbit/core';
import type { WorkspaceAdded, WorkspaceList } from '@orbit/protocol';
import { createRollback, createTools } from '@orbit/tools';
import { z } from 'zod';

import { pickFolder } from './folder-picker.js';

/** A request the user can fix, with the status the HTTP layer should answer. */
export class WorkspaceError extends Error {
  constructor(
    message: string,
    readonly status: 400 | 404 | 409 | 501 = 400,
  ) {
    super(message);
    this.name = 'WorkspaceError';
  }
}

/** A registered workspace with the tools and rollback that are confined to it. */
export interface Workspace {
  id: string;
  name: string;
  /** The real path (symbolic links resolved). */
  path: string;
  /** The path as it was given; old event logs may hold this form. */
  givenPath: string;
  registry: ToolRegistry;
  rollback: (change: { path: string; before: string | null; after: string }) => Promise<void>;
}

const Item = z.object({ name: z.string().trim().min(1).max(40).optional(), path: z.string() });
const ConfigFile = z.object({ workspaces: z.array(Item) });
type ConfigItem = z.infer<typeof Item>;

/** The same real directory always gets the same id, so it survives restarts and reordering. */
const idOf = (realPath: string) =>
  `w-${createHash('sha256').update(realPath).digest('hex').slice(0, 10)}`;

/**
 * Why a directory is too broad to be a workspace. The sandbox keeps the agent inside it, but a
 * workspace that is the whole disk or the whole home folder would put every key and document
 * inside.
 */
function tooBroad(realPath: string): string | null {
  if (realPath === path.parse(realPath).root) return '不能把磁盘根目录当作工作区';
  if (realPath === fs.realpathSync(os.homedir())) {
    return '不能把整个用户主目录当作工作区，请选其中的某个项目目录';
  }
  return null;
}

export interface WorkspaceManagerOptions {
  /** The workspace the server was started in (ORBIT_WORKSPACE or the current folder). */
  primary: string;
  /** The list of more workspaces; may be missing. Edited by hand or through the folder dialog. */
  file: string;
  /** Tools every workspace gets besides its own file tools: `report`, and those from MCP servers. */
  sharedTools: () => Tool[];
  /** Shows the operating system's folder dialog; replaced in tests. */
  picker?: () => Promise<string | null>;
  log?: (message: string) => void;
}

/**
 * The workspaces the agent may work in. The server decides which exist: the one it was started
 * in, plus a file. The web page can choose among them by id, and can ask the server to open a
 * folder dialog, but can never name a path itself (ADR 0014).
 */
export class WorkspaceManager {
  private readonly entries: Workspace[] = [];
  private errors: { source: string; message: string }[] = [];
  /** What the file holds now, in order. Kept so a change rewrites exactly the other entries. */
  private items: ConfigItem[] = [];
  /** The file exists but could not be read; it is never overwritten until fixed by hand. */
  private fileBroken = false;
  private picking = false;

  private constructor(private readonly options: WorkspaceManagerOptions) {}

  static async create(options: WorkspaceManagerOptions): Promise<WorkspaceManager> {
    const manager = new WorkspaceManager(options);
    // The starting workspace must work, as it always has: a bad one stops the server.
    manager.entries.push(await manager.build(path.resolve(options.primary), undefined));
    await manager.loadFile();
    for (const error of manager.errors) {
      (options.log ?? (() => undefined))(`workspace: ${error.source}: ${error.message}`);
    }
    return manager;
  }

  private async build(givenPath: string, name: string | undefined): Promise<Workspace> {
    const real = await fs.promises.realpath(givenPath);
    if (!(await fs.promises.stat(real)).isDirectory()) throw new Error('不是目录');
    const registry = new ToolRegistry();
    for (const tool of await createTools(real)) registry.register(tool);
    for (const tool of this.options.sharedTools()) {
      try {
        registry.register(tool);
      } catch (error) {
        (this.options.log ?? (() => undefined))(
          `workspace: skipped ${tool.name}: ${error instanceof Error ? error.message : error}`,
        );
      }
    }
    return {
      id: idOf(real),
      name: name ?? (path.basename(real) || real),
      path: real,
      givenPath,
      registry,
      rollback: await createRollback(real),
    };
  }

  /** Check a candidate against every rule for a workspace from the file or the dialog. */
  private async admit(item: ConfigItem): Promise<Workspace> {
    if (!path.isAbsolute(item.path)) throw new Error('路径必须是绝对路径');
    let workspace: Workspace;
    try {
      workspace = await this.build(item.path, item.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new Error('目录不存在', { cause: error });
      throw error;
    }
    const broad = tooBroad(workspace.path);
    if (broad) throw new Error(broad);
    return workspace;
  }

  private async loadFile(): Promise<void> {
    const source = path.basename(this.options.file);
    let raw: unknown;
    try {
      raw = JSON.parse(fs.readFileSync(this.options.file, 'utf8'));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.fileBroken = true;
        this.errors.push({ source, message: '文件不是有效的 JSON' });
      }
      return;
    }
    const parsed = ConfigFile.safeParse(raw);
    if (!parsed.success) {
      this.fileBroken = true;
      this.errors.push({
        source,
        message: '格式不对，应为 { "workspaces": [ { "name": "…", "path": "/绝对路径" } ] }',
      });
      return;
    }
    this.items = parsed.data.workspaces;
    for (const item of this.items) {
      try {
        const workspace = await this.admit(item);
        if (!this.entries.some((e) => e.id === workspace.id)) this.entries.push(workspace);
      } catch (error) {
        this.errors.push({
          source: item.path,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private saveFile(): void {
    fs.mkdirSync(path.dirname(this.options.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.options.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ workspaces: this.items }, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.options.file);
  }

  /** The workspace the server started in; always there. */
  primary(): Workspace {
    return this.entries[0]!;
  }

  /** A workspace by id; the primary one when no id is given. */
  resolve(id?: string): Workspace | undefined {
    return id === undefined ? this.primary() : this.entries.find((e) => e.id === id);
  }

  /** The workspace a stored run belongs to, found by the path its run.started recorded. */
  byPath(workspacePath: string): Workspace | undefined {
    const wanted = path.resolve(workspacePath);
    return this.entries.find((e) => e.path === wanted || path.resolve(e.givenPath) === wanted);
  }

  list(): WorkspaceList {
    return {
      workspaces: this.entries.map(({ id, name, path: p }) => ({ id, name, path: p })),
      defaultId: this.primary().id,
      errors: this.errors,
    };
  }

  /**
   * Open the operating system's folder dialog and register what the user chooses. The path comes
   * from their click, not from the web page. `added` is null when they cancel.
   */
  async pickAndAdd(name?: string): Promise<WorkspaceAdded> {
    if (this.picking) throw new WorkspaceError('已经有一个选择文件夹的窗口打开了', 409);
    if (this.fileBroken) {
      throw new WorkspaceError(
        'workspaces.json 格式不对，请先修好它（见设置页的提示），否则新增的会覆盖你手写的内容',
        409,
      );
    }
    this.picking = true;
    let chosen: string | null;
    try {
      chosen = await (this.options.picker ?? pickFolder)();
    } catch (error) {
      if (error instanceof Error && error.name === 'PickerUnsupported') {
        throw new WorkspaceError(error.message, 501);
      }
      throw error;
    } finally {
      this.picking = false;
    }
    if (chosen === null) return { ...this.list(), added: null };

    let workspace: Workspace;
    try {
      workspace = await this.admit({ path: chosen, ...(name ? { name } : {}) });
    } catch (error) {
      throw new WorkspaceError(error instanceof Error ? error.message : String(error), 400);
    }
    const existing = this.entries.find((e) => e.id === workspace.id);
    if (existing) {
      const { id, name: n, path: p } = existing;
      return { ...this.list(), added: { id, name: n, path: p } };
    }
    this.items = [...this.items, { path: workspace.path, ...(name ? { name } : {}) }];
    this.saveFile();
    this.entries.push(workspace);
    const { id, name: n, path: p } = workspace;
    return { ...this.list(), added: { id, name: n, path: p } };
  }

  /**
   * Forget a workspace. The folder and its files are untouched, and so are the conversations; they
   * can still be read, but not continued until the folder is registered again.
   */
  remove(id: string): WorkspaceList {
    if (id === this.primary().id) {
      throw new WorkspaceError('启动目录不能移除，它由启动服务端时的设置决定', 400);
    }
    const index = this.entries.findIndex((e) => e.id === id);
    if (index === -1) throw new WorkspaceError('找不到这个工作区', 404);
    if (this.fileBroken) {
      throw new WorkspaceError('workspaces.json 格式不对，请先修好它再移除', 409);
    }
    const [gone] = this.entries.splice(index, 1);
    this.items = this.items.filter((item) => {
      const real = (() => {
        try {
          return fs.realpathSync(item.path);
        } catch {
          return item.path;
        }
      })();
      return real !== gone!.path;
    });
    this.saveFile();
    return this.list();
  }
}
