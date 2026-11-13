import { Archive, ArchiveRestore, Folder, Search, Trash2 } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { SessionSummary } from '@/api';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/format';
import { groupSessions } from '@/state/groups';

interface Props {
  sessions: SessionSummary[];
  failed: boolean;
  onRestore: (sessionId: string) => void;
  /** Delete for good. Only called after the user confirmed here. */
  onPurge: (sessionId: string) => void;
  onClose: () => void;
}

const iconButton =
  'flex size-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

/**
 * Conversations the user removed from the list. They can be brought back, or deleted for good,
 * which also deletes everything they held (ADR 0015). Deleting needs a second click.
 */
export function ArchiveView({ sessions, failed, onRestore, onPurge, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [confirming, setConfirming] = useState<string | null>(null);

  const groups = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const shown =
      needle === ''
        ? sessions
        : sessions.filter((s) => `${s.title} ${s.snippet}`.toLowerCase().includes(needle));
    return groupSessions(shown);
  }, [sessions, query]);

  return (
    <main className="min-w-0 flex-1 overflow-y-auto" aria-label="已归档的聊天">
      <div className="mx-auto max-w-3xl space-y-5 p-8">
        <header className="flex items-center gap-3">
          <Archive aria-hidden className="size-5 text-muted-foreground" />
          <h1 className="min-w-0 flex-1 text-xl font-semibold">已归档的聊天</h1>
          <Button variant="outline" onClick={onClose}>
            返回
          </Button>
        </header>
        <p className="text-sm text-muted-foreground">
          从会话列表里移走的聊天放在这里，可以恢复。永久删除会连同里面所有记录一起删掉，无法找回。
        </p>

        <div className="relative">
          <Search
            aria-hidden
            className="absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索已归档的聊天…"
            aria-label="搜索已归档的聊天"
            className="h-10 w-full rounded-lg border bg-background pr-3 pl-9 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>

        {failed && (
          <p role="alert" className="text-sm text-destructive">
            读取已归档的聊天失败
          </p>
        )}
        {!failed && groups.length === 0 && (
          <p className="rounded-xl border border-dashed p-6 text-center text-sm text-muted-foreground">
            {query ? '没有匹配的聊天' : '还没有归档的聊天'}
          </p>
        )}

        {groups.map((group) => (
          <section key={group.key} aria-label={`工作区 ${group.name}`} className="space-y-2">
            <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
              <Folder aria-hidden className="size-4" />
              <span className="truncate" title={group.key}>
                {group.name}
              </span>
              <span className="ml-auto text-xs">{group.sessions.length} 个聊天</span>
            </div>
            <ul className="divide-y rounded-xl border bg-card/50">
              {group.sessions.map((s) => (
                <li key={s.sessionId} className="flex items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">{s.title}</p>
                    {confirming === s.sessionId ? (
                      <p role="alert" className="text-xs text-destructive">
                        永久删除这个聊天和里面的所有记录？无法恢复。
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">{formatDateTime(s.updatedAt)}</p>
                    )}
                  </div>
                  {confirming === s.sessionId ? (
                    <>
                      <Button
                        size="sm"
                        variant="destructive"
                        onClick={() => {
                          setConfirming(null);
                          onPurge(s.sessionId);
                        }}
                      >
                        永久删除
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setConfirming(null)}>
                        取消
                      </Button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        className={iconButton}
                        aria-label={`永久删除“${s.title}”`}
                        title="永久删除"
                        onClick={() => setConfirming(s.sessionId)}
                      >
                        <Trash2 aria-hidden className="size-4" />
                      </button>
                      <Button size="sm" variant="outline" onClick={() => onRestore(s.sessionId)}>
                        <ArchiveRestore aria-hidden data-icon="inline-start" />
                        恢复
                      </Button>
                    </>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </main>
  );
}
