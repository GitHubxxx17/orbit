import { Orbit, PanelLeft, PanelRight, Rewind } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  deleteSession,
  fetchInfo,
  forkSession,
  renameSession,
  rollbackChange,
  type ApprovalMode,
  type RunMode,
  type ServerInfo,
} from '@/api';
import { Composer } from '@/components/composer';
import { Conversation } from '@/components/conversation';
import { EmptyState } from '@/components/empty-state';
import { ReplayBar } from '@/components/replay-bar';
import { RightPanel } from '@/components/right-panel';
import { SettingsView } from '@/components/settings-view';
import { Sidebar } from '@/components/sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useBalance } from '@/hooks/use-balance';
import { useReplay } from '@/hooks/use-replay';
import { useRun } from '@/hooks/use-run';
import { useSessions } from '@/hooks/use-sessions';
import { useTheme } from '@/hooks/use-theme';
import { balanceChip } from '@/lib/balance';
import { collectChanges, type Change } from '@/state/changes';
import { emptyRun } from '@/state/timeline';

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
  const [settingsOpen, setSettingsOpen] = useState(false);

  const loadInfo = () => fetchInfo().then(setInfo, () => setInfoFailed(true));
  useEffect(() => {
    void loadInfo();
  }, []);

  // The list is fetched again when a run starts or ends.
  const {
    sessions,
    failed: sessionsFailed,
    refresh: refreshSessions,
  } = useSessions(`${session.turns.length}:${view.status}:${sessionId ?? ''}`);

  const changes = useMemo(() => collectChanges(session.turns), [session.turns]);

  // While replaying, the screen shows the replayed conversation and nothing can be changed.
  const replay = useReplay();
  const replaying = replay.active;
  const shown = replaying ? replay.view : session;
  const shownLast = shown.turns.at(-1) ?? emptyRun;
  const shownChanges = useMemo(
    () => (replaying ? collectChanges(replay.view.turns) : changes),
    [replaying, replay.view.turns, changes],
  );

  const running = view.status === 'running';
  const hasConversation = session.turns.length > 0;
  const canSend = text.trim() !== '' && !running && info !== null;
  const workspaceName = info?.workspaceName ?? '工作区';
  const modelLabel = mode === 'live' ? (info?.liveModel ?? '真实模型') : '演示模型';
  const title = session.turns[0]?.prompt ?? '新会话';
  // The balance of the account behind the real model; the demo model costs nothing.
  const { balance } = useBalance(
    `${session.turns.length}:${view.status}:${info?.liveModel ?? ''}`,
    mode === 'live' && info?.liveModel != null,
  );
  const chip = balanceChip(balance);

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

  const rollback = useCallback(
    async (change: Change) => {
      if (!change.runId || !sessionId) throw new Error('找不到这次修改所属的运行');
      await rollbackChange(change.runId, change.callId);
      // The log now holds the rollback; reload it so the panel and timeline show it.
      await openSession(sessionId);
    },
    [sessionId, openSession],
  );

  const fork = useCallback(
    (turn: number) => {
      if (!sessionId) return;
      setActionError(null);
      forkSession(sessionId, turn).then(
        async (id) => {
          refreshSessions();
          await openSession(id);
        },
        (e: unknown) => setActionError(e instanceof Error ? e.message : String(e)),
      );
    },
    [sessionId, openSession, refreshSessions],
  );

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
      balance={chip}
      placeholder={hasConversation ? '继续追问…（Enter 发送，Shift+Enter 换行）' : '随心输入'}
    />
  );

  if (settingsOpen) {
    return <SettingsView onBack={() => setSettingsOpen(false)} onChanged={() => void loadInfo()} />;
  }

  return (
    <div className="flex h-screen bg-background text-foreground">
      {sidebarOpen && (
        <div className="hidden md:block">
          <Sidebar
            workspaceName={workspaceName}
            sessions={sessions}
            failed={sessionsFailed}
            activeId={sessionId}
            onSelect={(id) => {
              replay.exit();
              void openSession(id);
            }}
            onNew={() => {
              replay.exit();
              newSession();
            }}
            onRename={rename}
            onDelete={remove}
            onOpenSettings={() => setSettingsOpen(true)}
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

          {hasConversation && !replaying && (
            <Badge variant={running ? 'default' : 'secondary'}>{STATUS_LABEL[view.status]}</Badge>
          )}
          {replaying && <Badge variant="secondary">回放中</Badge>}
          {connection === 'reconnecting' && <Badge variant="destructive">重新连接中…</Badge>}
          {sessionId && !running && !replaying && hasConversation && (
            <Button variant="ghost" size="sm" onClick={() => void replay.enter(sessionId)}>
              <Rewind aria-hidden className="size-3.5" />
              回放
            </Button>
          )}
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
            {hasConversation || replaying ? (
              <>
                <div className="min-h-0 flex-1 overflow-y-auto">
                  <Conversation
                    session={shown}
                    liveModel={info?.liveModel ?? null}
                    onApprove={replaying ? null : approve}
                    onFork={replaying || !sessionId ? null : fork}
                  />
                </div>
                <div className="mx-auto w-full max-w-3xl p-3">
                  {(error ?? replay.error) && (
                    <p role="alert" className="mb-2 text-sm text-destructive">
                      {error ?? replay.error}
                    </p>
                  )}
                  {replaying ? (
                    <ReplayBar
                      step={replay.step}
                      total={replay.total}
                      current={replay.current}
                      playing={replay.playing}
                      onGoTo={replay.goTo}
                      onToggle={replay.toggle}
                      onExit={replay.exit}
                    />
                  ) : (
                    composer
                  )}
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
              <RightPanel
                rows={shownLast.rows}
                lastSeq={shownLast.lastSeq}
                changes={shownChanges}
                onRollback={replaying ? null : rollback}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
