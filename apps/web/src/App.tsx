import { Orbit, PanelLeft, PanelRight } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import {
  deleteSession,
  fetchInfo,
  renameSession,
  type ApprovalMode,
  type RunMode,
  type ServerInfo,
} from '@/api';
import { Composer } from '@/components/composer';
import { Conversation } from '@/components/conversation';
import { EmptyState } from '@/components/empty-state';
import { RightPanel } from '@/components/right-panel';
import { Sidebar } from '@/components/sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useRun } from '@/hooks/use-run';
import { useSessions } from '@/hooks/use-sessions';
import { useTheme } from '@/hooks/use-theme';
import { collectChanges } from '@/state/changes';

const STATUS_LABEL = {
  idle: '空闲',
  running: '运行中',
  completed: '已完成',
  failed: '已失败',
} as const;

export function App() {
  const {
    session,
    sessionId,
    view,
    connection,
    error,
    start,
    cancel,
    approve,
    newSession,
    openSession,
  } = useRun();
  const { theme, cycle: cycleTheme } = useTheme();

  const [info, setInfo] = useState<ServerInfo | null>(null);
  const [infoFailed, setInfoFailed] = useState(false);
  const [mode, setMode] = useState<RunMode>('demo');
  const [approval, setApproval] = useState<ApprovalMode>('ask');
  const [text, setText] = useState('');
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [panelOpen, setPanelOpen] = useState(true);

  useEffect(() => {
    fetchInfo().then(setInfo, () => setInfoFailed(true));
  }, []);

  // The list is fetched again when a run starts or ends.
  const {
    sessions,
    failed: sessionsFailed,
    refresh: refreshSessions,
  } = useSessions(`${session.turns.length}:${view.status}:${sessionId ?? ''}`);

  const changes = useMemo(() => collectChanges(session.turns), [session.turns]);

  const running = view.status === 'running';
  const hasConversation = session.turns.length > 0;
  const canSend = text.trim() !== '' && !running && info !== null;
  const workspaceName = info?.workspaceName ?? '工作区';
  const modelLabel = mode === 'live' ? (info?.liveModel ?? '真实模型') : '演示模型';
  const title = session.turns[0]?.prompt ?? '新会话';

  const [actionError, setActionError] = useState<string | null>(null);

  const rename = (id: string, title: string) => {
    setActionError(null);
    renameSession(id, title).then(refreshSessions, (e: unknown) =>
      setActionError(e instanceof Error ? e.message : String(e)),
    );
  };

  const remove = (id: string) => {
    setActionError(null);
    deleteSession(id).then(
      () => {
        // If the open conversation was the one deleted, leave it.
        if (id === sessionId) newSession();
        refreshSessions();
      },
      (e: unknown) => setActionError(e instanceof Error ? e.message : String(e)),
    );
  };

  const send = () => {
    if (!canSend) return;
    const prompt = text.trim();
    setText('');
    // If it could not be sent, give the text back so it is not lost.
    void start(prompt, mode, approval).then((sent) => {
      if (!sent) setText(prompt);
    });
  };

  const composer = (
    <Composer
      value={text}
      onChange={setText}
      onSend={send}
      onStop={() => void cancel()}
      running={running}
      canSend={canSend}
      mode={mode}
      onMode={setMode}
      availableModes={info?.modes ?? ['demo']}
      approval={approval}
      onApproval={setApproval}
      workspaceName={workspaceName}
      modelLabel={modelLabel}
      placeholder={hasConversation ? '继续追问…（Enter 发送，Shift+Enter 换行）' : '随心输入'}
    />
  );

  return (
    <div className="flex h-screen bg-background text-foreground">
      {sidebarOpen && (
        <div className="hidden md:block">
          <Sidebar
            workspaceName={workspaceName}
            sessions={sessions}
            failed={sessionsFailed}
            activeId={sessionId}
            onSelect={(id) => void openSession(id)}
            onNew={newSession}
            onRename={rename}
            onDelete={remove}
          />
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-12 shrink-0 items-center gap-2 border-b px-3">
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:inline-flex"
            onClick={() => setSidebarOpen((open) => !open)}
            aria-label={sidebarOpen ? '收起会话栏' : '展开会话栏'}
            aria-expanded={sidebarOpen}
          >
            <PanelLeft aria-hidden className="size-4" />
          </Button>
          <Orbit aria-hidden className="size-5 text-sky-500" />
          <span className="text-sm font-semibold tracking-tight">星轨</span>
          <span aria-hidden className="text-muted-foreground">
            /
          </span>
          <h1 className="min-w-0 flex-1 truncate text-sm text-muted-foreground" title={title}>
            {title}
          </h1>

          {hasConversation && (
            <Badge variant={running ? 'default' : 'secondary'}>{STATUS_LABEL[view.status]}</Badge>
          )}
          {connection === 'reconnecting' && <Badge variant="destructive">重新连接中…</Badge>}
          <ThemeToggle theme={theme} onCycle={cycleTheme} />
          <Button
            variant="ghost"
            size="icon"
            className="hidden lg:inline-flex"
            onClick={() => setPanelOpen((open) => !open)}
            aria-label={panelOpen ? '收起侧栏' : '展开侧栏'}
            aria-expanded={panelOpen}
          >
            <PanelRight aria-hidden className="size-4" />
          </Button>
        </header>

        {actionError && (
          <p role="alert" className="bg-destructive/10 px-4 py-2 text-sm text-destructive">
            {actionError}
          </p>
        )}

        {infoFailed && (
          <p role="alert" className="bg-destructive/10 px-4 py-2 text-sm text-destructive">
            连不上服务端。请先在另一个终端启动服务端：pnpm --filter @orbit/server dev。
          </p>
        )}

        <div className="flex min-h-0 flex-1">
          <main className="flex min-w-0 flex-1 flex-col" aria-label="对话">
            {hasConversation ? (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <Conversation
                    session={session}
                    liveModel={info?.liveModel ?? null}
                    onApprove={approve}
                  />
                </div>
                <div className="mx-auto w-full max-w-3xl p-3">
                  {error && (
                    <p role="alert" className="mb-2 text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  {composer}
                </div>
              </>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center gap-8 p-6">
                <EmptyState workspaceName={workspaceName} onPick={setText} />
                <div className="w-full max-w-2xl">
                  {error && (
                    <p role="alert" className="mb-2 text-sm text-destructive">
                      {error}
                    </p>
                  )}
                  {composer}
                </div>
              </div>
            )}
          </main>

          {panelOpen && (
            <div className="hidden lg:block">
              <RightPanel rows={view.rows} lastSeq={view.lastSeq} changes={changes} />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
