import {
  Archive,
  ChevronRight,
  Folder,
  FolderOpen,
  FolderPlus,
  Pencil,
  Search,
  Settings,
  SquarePen,
} from 'lucide-react';
import { useMemo, useState, type KeyboardEvent } from 'react';

import type { SessionSummary, WorkspaceInfo } from '@/api';
import { Button } from '@/components/ui/button';
import { useCollapsed } from '@/hooks/use-collapsed';
import { relativeTime } from '@/lib/format';
import { groupSessions } from '@/state/groups';

const STATUS: Record<SessionSummary['status'], { label: string; dot: string }> = {
  running: { label: '运行中', dot: 'bg-sky-500 animate-pulse' },
  awaiting: { label: '等待你审批', dot: 'bg-orange-500 animate-pulse' },
  failed: { label: '运行失败或被中断', dot: 'bg-red-500' },
  idle: { label: '', dot: 'bg-transparent' },
};

interface Props {
  /** How many conversations are in the archive, and a way to open it. */
  archivedCount: number;
  archiveOpen: boolean;
  onOpenArchive: () => void;
  /** The registered workspaces; each gets a group, even with no conversation yet. */
  workspaces: WorkspaceInfo[];
  /** Open the folder dialog to add a workspace. */
  onAddWorkspace: () => void;
  /** The dialog is open, waiting for the user. */
  addingWorkspace: boolean;
  /** Start a new conversation in this workspace. */
  onNewIn: (workspaceId: string) => void;
  sessions: SessionSummary[];
  /** The list could not be fetched. */
  failed: boolean;
  activeId: string | null;
  onSelect: (sessionId: string) => void;
  onNew: () => void;
  onRename: (sessionId: string, title: string) => void;
  onDelete: (sessionId: string) => void;
  onOpenSettings: () => void;
}

const iconButton =
  'flex size-6 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none';

export function Sidebar(props: Props) {
  const {
    archivedCount,
    archiveOpen,
    onOpenArchive,
    workspaces,
    onAddWorkspace,
    addingWorkspace,
    onNewIn,
    sessions,
    failed,
    activeId,
    onSelect,
    onNew,
    onRename,
    onDelete,
    onOpenSettings,
  } = props;
  const { collapsed, toggle } = useCollapsed();
  const [query, setQuery] = useState('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [confirmingId, setConfirmingId] = useState<string | null>(null);

  const shown = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (needle === '') return sessions;
    return sessions.filter((s) => `${s.title} ${s.snippet}`.toLowerCase().includes(needle));
  }, [sessions, query]);
  // While searching, only groups with a match are worth showing.
  const groups = useMemo(
    () =>
      groupSessions(shown, workspaces).filter(
        (group) => query.trim() === '' || group.sessions.length > 0,
      ),
    [shown, workspaces, query],
  );

  const startRename = (session: SessionSummary) => {
    setConfirmingId(null);
    setEditingId(session.sessionId);
    setDraft(session.title);
  };

  const finishRename = (session: SessionSummary, save: boolean) => {
    setEditingId(null);
    const title = draft.trim();
    if (save && title !== '' && title !== session.title) onRename(session.sessionId, title);
  };

  const onRenameKey = (event: KeyboardEvent<HTMLInputElement>, session: SessionSummary) => {
    // While an input method is composing, Enter confirms the candidate and must not save.
    if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
      event.preventDefault();
      finishRename(session, true);
    } else if (event.key === 'Escape') {
      finishRename(session, false);
    }
  };

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
        {failed && (
          <p role="alert" className="px-2 py-2 text-xs text-destructive">
            读取会话列表失败
          </p>
        )}
        <div className="flex items-center px-2 pb-1 text-xs text-muted-foreground">
          <span>工作区</span>
          <button
            type="button"
            className={`${iconButton} ml-auto`}
            aria-label="添加工作区"
            title={addingWorkspace ? '请在弹出的窗口里选择文件夹' : '添加工作区'}
            disabled={addingWorkspace}
            onClick={onAddWorkspace}
          >
            <FolderPlus aria-hidden className="size-3.5" />
          </button>
        </div>
        {addingWorkspace && (
          <p role="status" className="px-2 pb-1 text-xs text-muted-foreground">
            请在弹出的窗口里选择文件夹（窗口可能在其他窗口后面）…
          </p>
        )}
        {!failed && query && shown.length === 0 && (
          <p className="px-2 py-3 text-xs text-muted-foreground">没有匹配的会话</p>
        )}

        {groups.map((group) => {
          // A search shows every match, folded or not.
          const open = query.trim() !== '' || !collapsed.has(group.key);
          const FolderIcon = open ? FolderOpen : Folder;
          const attention = group.sessions.some(
            (s) => s.status === 'awaiting' || s.status === 'running',
          );
          return (
            <section key={group.key} aria-label={`工作区 ${group.name}`} className="mb-2">
              <div className="flex items-center gap-1 pr-1">
                <button
                  type="button"
                  aria-expanded={open}
                  onClick={() => toggle(group.key)}
                  className="flex min-w-0 flex-1 items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs font-medium text-muted-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                >
                  <ChevronRight
                    aria-hidden
                    className={`size-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`}
                  />
                  <FolderIcon aria-hidden className="size-3.5 shrink-0" />
                  <span className="truncate" title={group.key || group.name}>
                    {group.name}
                  </span>
                  {!open && attention && (
                    <>
                      <span aria-hidden className="size-2 shrink-0 rounded-full bg-orange-500" />
                      <span className="sr-only">有会话在运行或等你审批</span>
                    </>
                  )}
                  <span className="ml-auto shrink-0">{group.sessions.length}</span>
                </button>
                {group.workspaceId !== null && (
                  <button
                    type="button"
                    className={iconButton}
                    aria-label={`在 ${group.name} 里新建会话`}
                    title={`在 ${group.name} 里新建会话`}
                    onClick={() => onNewIn(group.workspaceId!)}
                  >
                    <SquarePen aria-hidden className="size-3.5" />
                  </button>
                )}
              </div>
              {open && group.sessions.length === 0 && (
                <p className="px-2 py-1 text-xs text-muted-foreground">还没有会话</p>
              )}
              {open && (
                <ul className="space-y-0.5">
                  {group.sessions.map((s) => {
                    const active = s.sessionId === activeId;
                    const status = STATUS[s.status];
                    const editing = editingId === s.sessionId;
                    const confirming = confirmingId === s.sessionId;

                    return (
                      <li key={s.sessionId} className="group relative">
                        {editing ? (
                          <div className="rounded-lg bg-muted px-2.5 py-2">
                            <input
                              autoFocus
                              value={draft}
                              maxLength={80}
                              aria-label="会话标题"
                              onChange={(event) => setDraft(event.target.value)}
                              onKeyDown={(event) => onRenameKey(event, s)}
                              onBlur={() => finishRename(s, true)}
                              className="w-full rounded border bg-background px-1.5 py-0.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            />
                          </div>
                        ) : confirming ? (
                          <div
                            className="rounded-lg bg-muted px-2.5 py-2 text-sm"
                            role="alertdialog"
                            aria-label="确认归档"
                          >
                            <p className="truncate">归档“{s.title}”？</p>
                            <p className="text-xs text-muted-foreground">
                              会移到“已归档的聊天”，随时可以恢复。
                            </p>
                            <div className="mt-2 flex gap-2">
                              <Button
                                size="sm"
                                variant="destructive"
                                onClick={() => {
                                  setConfirmingId(null);
                                  onDelete(s.sessionId);
                                }}
                              >
                                归档
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => setConfirmingId(null)}
                              >
                                取消
                              </Button>
                            </div>
                          </div>
                        ) : (
                          <>
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
                                <span className="ml-auto shrink-0">
                                  {relativeTime(s.updatedAt)}
                                </span>
                              </span>
                            </button>
                            <div className="absolute top-1.5 right-1.5 hidden gap-0.5 rounded bg-muted p-0.5 group-focus-within:flex group-hover:flex">
                              <button
                                type="button"
                                className={iconButton}
                                aria-label={`重命名“${s.title}”`}
                                onClick={() => startRename(s)}
                              >
                                <Pencil aria-hidden className="size-3.5" />
                              </button>
                              <button
                                type="button"
                                className={iconButton}
                                aria-label={`归档“${s.title}”`}
                                onClick={() => {
                                  setEditingId(null);
                                  setConfirmingId(s.sessionId);
                                }}
                              >
                                <Archive aria-hidden className="size-3.5" />
                              </button>
                            </div>
                          </>
                        )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          );
        })}
      </div>

      <div className="space-y-0.5 border-t p-2">
        <Button
          variant="ghost"
          className="w-full justify-start"
          aria-current={archiveOpen ? 'page' : undefined}
          onClick={onOpenArchive}
        >
          <Archive aria-hidden data-icon="inline-start" />
          已归档的聊天
          {archivedCount > 0 && (
            <span className="ml-auto text-xs text-muted-foreground">{archivedCount}</span>
          )}
        </Button>
        <Button variant="ghost" className="w-full justify-start" onClick={onOpenSettings}>
          <Settings aria-hidden data-icon="inline-start" />
          设置
        </Button>
      </div>
    </nav>
  );
}
