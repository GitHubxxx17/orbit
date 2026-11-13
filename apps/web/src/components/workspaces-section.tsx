import { Folder } from 'lucide-react';
import { useState } from 'react';

import { pickWorkspace, removeWorkspace } from '@/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useWorkspaces } from '@/hooks/use-workspaces';

interface Props {
  /** The list changed; the app should read it again. */
  onChanged: () => void;
}

type Notice = { kind: 'ok' | 'error'; text: string } | null;

/**
 * The folders the agent may work in. A folder is added through the operating system's own dialog,
 * opened by the server: this page never sends a path, so a page cannot give the agent a folder the
 * person at the computer did not choose (ADR 0014).
 */
export function WorkspacesSection({ onChanged }: Props) {
  const { list, failed, adopt } = useWorkspaces();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice>(null);

  const fail = (error: unknown) =>
    setNotice({ kind: 'error', text: error instanceof Error ? error.message : String(error) });

  const add = async () => {
    setBusy(true);
    setNotice(null);
    try {
      const result = await pickWorkspace(name.trim() || undefined);
      adopt(result);
      onChanged();
      if (result.added) {
        setName('');
        setNotice({ kind: 'ok', text: `已添加：${result.added.name}` });
      }
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (id: string) => {
    setConfirmRemove(null);
    setBusy(true);
    setNotice(null);
    try {
      adopt(await removeWorkspace(id));
      onChanged();
      setNotice({ kind: 'ok', text: '已移除，文件夹和会话都没有动' });
    } catch (error) {
      fail(error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="min-w-0 flex-1 overflow-y-auto p-8" aria-label="工作区设置">
      <div className="mx-auto max-w-xl space-y-5">
        <header>
          <h1 className="text-lg font-semibold">工作区</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            智能体只能读写工作区里的文件。新对话在输入框里选工作区，开始之后就固定在那个工作区里。
          </p>
        </header>

        {failed && (
          <p role="alert" className="text-sm text-destructive">
            读取工作区失败，请确认服务端在运行。
          </p>
        )}

        <ul className="space-y-2" aria-label="已登记的工作区">
          {list.workspaces.map((workspace) => (
            <li key={workspace.id} className="rounded-xl border bg-card/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Folder aria-hidden className="size-4 shrink-0 text-muted-foreground" />
                <span className="min-w-0 truncate font-medium">{workspace.name}</span>
                {workspace.id === list.defaultId && <Badge variant="secondary">启动目录</Badge>}
              </div>
              <p className="mt-1 truncate font-mono text-xs text-muted-foreground">
                {workspace.path}
              </p>
              {workspace.id !== list.defaultId && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {confirmRemove === workspace.id ? (
                    <>
                      <Button
                        type="button"
                        size="sm"
                        variant="destructive"
                        disabled={busy}
                        onClick={() => void remove(workspace.id)}
                      >
                        确认移除
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => setConfirmRemove(null)}
                      >
                        取消
                      </Button>
                      <p className="basis-full text-xs text-muted-foreground">
                        只是从列表里去掉，文件夹和里面的文件不会动。这个工作区里的旧会话还能看，但不能再继续聊。
                      </p>
                    </>
                  ) : (
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      disabled={busy}
                      onClick={() => setConfirmRemove(workspace.id)}
                    >
                      移除
                    </Button>
                  )}
                </div>
              )}
            </li>
          ))}
        </ul>

        <section className="space-y-3 rounded-xl border p-4" aria-label="添加工作区">
          <h2 className="text-sm font-semibold">添加工作区</h2>
          <div className="space-y-1.5">
            <label htmlFor="workspace-name" className="text-sm font-medium">
              名称
            </label>
            <input
              id="workspace-name"
              className="h-9 w-full rounded-lg border bg-background px-3 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
              value={name}
              maxLength={40}
              onChange={(e) => setName(e.target.value)}
              placeholder="可选，留空则用文件夹名"
              autoComplete="off"
            />
          </div>
          <Button type="button" disabled={busy} onClick={() => void add()}>
            {busy ? '请在弹出的窗口里选择文件夹…' : '选择文件夹添加…'}
          </Button>
          <p className="text-xs text-muted-foreground">
            会在这台电脑上弹出系统的选择文件夹窗口（目前只支持
            macOS；窗口可能出现在其他窗口后面）。不能选磁盘根目录或整个用户主目录。
          </p>
          {notice && (
            <p
              role={notice.kind === 'error' ? 'alert' : 'status'}
              className={`text-sm ${
                notice.kind === 'error'
                  ? 'text-destructive'
                  : 'text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {notice.text}
            </p>
          )}
        </section>

        {list.errors.length > 0 && (
          <section aria-label="没能使用的工作区" className="space-y-1">
            <h2 className="text-sm font-medium text-amber-700 dark:text-amber-400">
              有 {list.errors.length} 项没能使用
            </h2>
            <ul className="space-y-1">
              {list.errors.map((error, index) => (
                <li
                  key={`${error.source}-${index}`}
                  className="rounded-md border border-amber-500/40 bg-amber-500/5 px-3 py-2 text-xs"
                >
                  <span className="font-mono">{error.source}</span>：{error.message}
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="text-xs text-muted-foreground">
          也可以手动编辑数据文件夹里的 <code className="font-mono">workspaces.json</code>
          （默认在 <code className="font-mono">~/.orbit/</code>），改完重启服务端。
        </p>
      </div>
    </main>
  );
}
