import { Folder, Search, SquarePen } from 'lucide-react';
import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import { relativeTime } from '@/lib/format';
import type { SessionSummary } from '@/api';

const STATUS: Record<SessionSummary['status'], { label: string; dot: string }> = {
  running: { label: '运行中', dot: 'bg-sky-500 animate-pulse' },
  awaiting: { label: '等待你审批', dot: 'bg-orange-500 animate-pulse' },
  failed: { label: '运行失败', dot: 'bg-red-500' },
  idle: { label: '', dot: 'bg-transparent' },
};

interface Props {
  workspaceName: string;
  sessions: SessionSummary[];
  /** The list could not be fetched. */
  failed: boolean;
  activeId: string | null;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
}

export function Sidebar({ workspaceName, sessions, failed, activeId, onSelect, onNew }: Props) {
  const [query, setQuery] = useState('');

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return sessions;
    return sessions.filter((s) => `${s.title} ${s.snippet}`.toLowerCase().includes(needle));
  }, [sessions, query]);

  return (
    <nav aria-label="会话" className="flex h-full w-72 shrink-0 flex-col border-r bg-sidebar">
      <div className="space-y-2 p-3">
        <Button variant="outline" className="w-full justify-start" onClick={onNew}>
          <SquarePen aria-hidden data-icon="inline-start" />
          新会话
        </Button>
        <div className="relative">
          <Search
            aria-hidden
            className="absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
          />
          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索会话…"
            aria-label="搜索会话"
            className="h-9 w-full rounded-lg border bg-background pr-3 pl-8 text-sm outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        <div className="flex items-center gap-2 px-2 py-1.5 text-xs font-medium text-muted-foreground">
          <Folder aria-hidden className="size-3.5" />
          <span className="truncate" title={workspaceName}>
            {workspaceName}
          </span>
          <span className="ml-auto">{sessions.length}</span>
        </div>

        {failed && (
          <p role="alert" className="px-2 py-2 text-xs text-destructive">
            读取会话列表失败
          </p>
        )}
        {!failed && shown.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">
            {query ? '没有匹配的会话' : '还没有会话'}
          </p>
        )}

        <ul className="space-y-0.5">
          {shown.map((s) => {
            const active = s.sessionId === activeId;
            const status = STATUS[s.status];
            return (
              <li key={s.sessionId}>
                <button
                  type="button"
                  onClick={() => onSelect(s.sessionId)}
                  aria-current={active ? 'true' : undefined}
                  className={`w-full rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none ${
                    active ? 'bg-muted' : ''
                  }`}
                >
                  <span className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium">{s.title}</span>
                    <span
                      aria-hidden
                      className={`ml-auto size-2 shrink-0 rounded-full ${status.dot}`}
                    />
                    {status.label && <span className="sr-only">{status.label}</span>}
                  </span>
                  <span className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    <span className="truncate">{s.snippet || '…'}</span>
                    <span className="ml-auto shrink-0">{relativeTime(s.updatedAt)}</span>
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </nav>
  );
}
