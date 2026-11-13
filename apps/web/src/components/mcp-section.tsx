import { useEffect, useState } from 'react';

import { fetchMcp, type McpStatus } from '@/api';

const STATE = {
  connected: { label: '已连接', className: 'text-emerald-600 dark:text-emerald-400' },
  failed: { label: '连接失败', className: 'text-red-600 dark:text-red-400' },
  disabled: { label: '已停用', className: 'text-muted-foreground' },
} as const;

const RISK = {
  read: { label: '只读，自动放行', className: 'text-emerald-600 dark:text-emerald-400' },
  write: { label: '每轮询问', className: 'text-orange-600 dark:text-orange-400' },
} as const;

/**
 * The MCP servers Orbit connected to, read-only. They are set up by editing `mcp.json` by hand,
 * because a stdio server is a program started on this computer and a web page must not be able to
 * add one.
 */
export function McpSection() {
  const [status, setStatus] = useState<McpStatus | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    fetchMcp().then(setStatus, () => setFailed(true));
  }, []);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto p-8" aria-label="MCP 设置">
      <div className="mx-auto max-w-xl space-y-5">
        <header>
          <h1 className="text-lg font-semibold">MCP 服务器</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            MCP 服务器让智能体使用外部工具。这里只显示状态：为了安全，服务器只能通过编辑本机的
            ~/.orbit/mcp.json 配置，改完后重启星轨生效。
          </p>
        </header>

        <p className="rounded-lg border bg-card/50 p-3 text-xs text-muted-foreground">
          MCP 工具默认每轮都要你批准，只有你在配置里列为只读的才会自动放行。MCP
          服务器运行在你的电脑上，不受工作区沙箱限制，请只连接你信任的服务器。
        </p>

        {failed && (
          <p role="alert" className="text-sm text-destructive">
            读取失败，请确认服务端在运行。
          </p>
        )}

        {status?.configError && (
          <p role="alert" className="text-sm text-destructive">
            配置文件无法使用，没有启动任何服务器：{status.configError}
          </p>
        )}

        {status && !status.configError && status.servers.length === 0 && (
          <p className="text-sm text-muted-foreground">还没有配置任何 MCP 服务器。</p>
        )}

        <ul className="space-y-3" aria-label="MCP 服务器列表">
          {status?.servers.map((server) => {
            const state = STATE[server.state];
            return (
              <li key={server.id} className="rounded-xl border p-3">
                <div className="flex items-center gap-2 text-sm">
                  <span className="font-mono font-medium">{server.id}</span>
                  <span className="text-xs text-muted-foreground">{server.transport}</span>
                  <span className={`ml-auto text-xs ${state.className}`}>{state.label}</span>
                </div>
                {server.error && (
                  <p role="alert" className="mt-1.5 text-xs text-destructive">
                    {server.error}
                  </p>
                )}
                {server.tools.length > 0 && (
                  <ul className="mt-2 space-y-1" aria-label={`${server.id} 的工具`}>
                    {server.tools.map((tool) => {
                      const risk = RISK[tool.risk];
                      return (
                        <li key={tool.name}>
                          <details className="rounded-md border bg-background/60">
                            <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
                              <span className="truncate font-mono">{tool.name}</span>
                              <span className={`ml-auto shrink-0 ${risk.className}`}>
                                {risk.label}
                              </span>
                            </summary>
                            <p className="border-t px-2 py-2 text-xs whitespace-pre-wrap text-muted-foreground">
                              {tool.description}
                            </p>
                          </details>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {server.skipped.length > 0 && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    未使用：{server.skipped.join('；')}
                  </p>
                )}
              </li>
            );
          })}
        </ul>
      </div>
    </main>
  );
}
