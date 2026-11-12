/** Turn a tool call into a short sentence a person can read at a glance. */

const MAX_PATTERN_CHARS = 40;

const text = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

const whole = (value: unknown): number | null =>
  typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;

const isRoot = (path: string | null) => path === null || path === '.';

export function describeTool(tool: string, args: Record<string, unknown>): string {
  switch (tool) {
    case 'list_dir': {
      const path = text(args['path']);
      return isRoot(path) ? '查看工作区目录' : `查看目录 ${path}`;
    }
    case 'read_file': {
      const path = text(args['path']);
      if (path === null) return '读取文件';
      const limit = whole(args['limit']);
      const offset = whole(args['offset']) ?? 1;
      if (limit === null && offset === 1) return `读取 ${path}`;
      const last = limit === null ? '末尾' : String(offset + limit - 1);
      return `读取 ${path} 第 ${offset}-${last} 行`;
    }
    case 'grep': {
      const pattern = text(args['pattern']);
      if (pattern === null) return '搜索代码';
      const shown =
        pattern.length > MAX_PATTERN_CHARS ? `${pattern.slice(0, MAX_PATTERN_CHARS)}…` : pattern;
      const path = text(args['path']);
      return isRoot(path) ? `搜索“${shown}”` : `在 ${path} 中搜索“${shown}”`;
    }
    case 'write_file': {
      const path = text(args['path']);
      return path === null ? '写入文件' : `写入 ${path}`;
    }
    default:
      return `调用 ${tool}`;
  }
}
