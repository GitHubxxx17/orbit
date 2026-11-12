import { Orbit, Send, Square } from 'lucide-react';
import { useEffect, useState, type KeyboardEvent } from 'react';

import { fetchModes, type RunMode } from '@/api';
import { Conversation } from '@/components/conversation';
import { Timeline } from '@/components/timeline';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Textarea } from '@/components/ui/textarea';
import { useRun } from '@/hooks/use-run';

const DEFAULT_PROMPT = '帮我看看这个工作区里有什么，并读一下 package.json。';

const STATUS_LABEL = {
  idle: '空闲',
  running: '运行中',
  completed: '已完成',
  failed: '已失败',
} as const;

export function App() {
  const { view, connection, error, start, cancel, approve } = useRun();
  const [modes, setModes] = useState<RunMode[] | null>(null);
  const [mode, setMode] = useState<RunMode>('demo');
  const [text, setText] = useState(DEFAULT_PROMPT);
  const [sentPrompt, setSentPrompt] = useState<string | null>(null);
  const [modesError, setModesError] = useState(false);

  useEffect(() => {
    fetchModes().then(setModes, () => setModesError(true));
  }, []);

  const running = view.status === 'running';
  const canSend = text.trim() !== '' && !running && modes !== null;

  const send = () => {
    if (!canSend) return;
    setSentPrompt(text.trim());
    void start(text.trim(), mode);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
      event.preventDefault();
      send();
    }
  };

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      <header className="flex items-center gap-3 border-b px-4 py-3">
        <Orbit aria-hidden className="size-5 text-sky-400" />
        <h1 className="text-base font-semibold tracking-tight">星轨 Orbit</h1>
        <Badge variant={running ? 'default' : 'secondary'}>{STATUS_LABEL[view.status]}</Badge>
        {connection === 'reconnecting' && <Badge variant="destructive">重新连接中…</Badge>}

        <div className="ml-auto flex items-center gap-2 text-sm" role="group" aria-label="运行模式">
          {(['demo', 'live'] as const).map((value) => (
            <Button
              key={value}
              size="sm"
              variant={mode === value ? 'default' : 'outline'}
              aria-pressed={mode === value}
              disabled={running || !modes?.includes(value)}
              title={modes?.includes(value) ? undefined : '服务端没有配置模型，不能使用真实模式'}
              onClick={() => setMode(value)}
            >
              {value === 'demo' ? '演示' : '真实模型'}
            </Button>
          ))}
        </div>
      </header>

      {modesError && (
        <p role="alert" className="bg-destructive/10 px-4 py-2 text-sm text-destructive">
          连不上服务端。请先在另一个终端运行 pnpm --filter @orbit/server dev。
        </p>
      )}

      <main className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,1fr)_380px]">
        <section className="flex min-h-0 flex-col" aria-label="对话">
          <ScrollArea className="min-h-0 flex-1">
            <Conversation prompt={sentPrompt} view={view} onApprove={approve} />
          </ScrollArea>

          <div className="border-t p-3">
            {error && (
              <p role="alert" className="mb-2 text-sm text-destructive">
                {error}
              </p>
            )}
            <div className="flex items-end gap-2">
              <Textarea
                aria-label="给智能体的指令"
                value={text}
                onChange={(event) => setText(event.target.value)}
                onKeyDown={onKeyDown}
                rows={2}
                className="min-h-0 flex-1 resize-none"
                placeholder="输入指令，Ctrl/⌘ + Enter 发送"
              />
              {running ? (
                <Button variant="destructive" onClick={() => void cancel()}>
                  <Square aria-hidden data-icon="inline-start" />
                  停止
                </Button>
              ) : (
                <Button onClick={send} disabled={!canSend}>
                  <Send aria-hidden data-icon="inline-start" />
                  运行
                </Button>
              )}
            </div>
          </div>
        </section>

        <aside className="hidden min-h-0 flex-col border-l md:flex" aria-label="事件时间线">
          <h2 className="border-b px-4 py-3 text-sm font-medium">
            事件时间线
            <span className="ml-2 font-mono text-xs text-muted-foreground">{view.lastSeq}</span>
          </h2>
          <ScrollArea className="min-h-0 flex-1">
            <Timeline rows={view.rows} />
          </ScrollArea>
        </aside>
      </main>
    </div>
  );
}
