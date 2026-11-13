import { ArrowUp, Folder, Square } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';

import type { ApprovalMode, RunMode } from '@/api';
import type { BalanceChip } from '@/lib/balance';

interface Props {
  value: string;
  onChange: (value: string) => void;
  onSend: () => void;
  onStop: () => void;
  running: boolean;
  canSend: boolean;
  mode: RunMode;
  onMode: (mode: RunMode) => void;
  /** Modes the server can start right now. */
  availableModes: RunMode[];
  approval: ApprovalMode;
  onApproval: (approval: ApprovalMode) => void;
  workspaceName: string;
  /** Name shown on the right: the live model, or the demo model. */
  modelLabel: string;
  /** The account balance next to the model name; null when there is nothing to show. */
  balance?: BalanceChip | null;
  placeholder: string;
}

const MODES: { value: RunMode; label: string }[] = [
  { value: 'demo', label: '演示' },
  { value: 'live', label: '真实模型' },
];

export function Composer(props: Props) {
  const input = useRef<HTMLTextAreaElement>(null);

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter sends, Shift+Enter breaks the line. While an input method is composing (Chinese,
    // Japanese...), Enter confirms the candidate and must not send.
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return;
    event.preventDefault();
    props.onSend();
  };

  return (
    <div className="rounded-2xl border bg-card shadow-sm focus-within:ring-2 focus-within:ring-ring/40">
      <textarea
        ref={input}
        aria-label="给智能体的指令"
        value={props.value}
        onChange={(event) => props.onChange(event.target.value)}
        onKeyDown={onKeyDown}
        rows={2}
        placeholder={props.placeholder}
        className="field-sizing-content max-h-60 min-h-14 w-full resize-none bg-transparent px-4 pt-3 text-[15px] outline-none placeholder:text-muted-foreground"
      />

      <div className="flex flex-wrap items-center gap-2 px-3 pb-3 text-xs">
        <span
          className="flex max-w-40 items-center gap-1 rounded-md bg-muted px-2 py-1 text-muted-foreground"
          title={`工作区：${props.workspaceName}`}
        >
          <Folder aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">{props.workspaceName}</span>
        </span>

        <div role="group" aria-label="运行模式" className="flex rounded-md bg-muted p-0.5">
          {MODES.map(({ value, label }) => {
            const available = props.availableModes.includes(value);
            return (
              <button
                key={value}
                type="button"
                aria-pressed={props.mode === value}
                disabled={props.running || !available}
                title={available ? undefined : '服务端没有配置模型，不能使用真实模型'}
                onClick={() => props.onMode(value)}
                className={`rounded px-2 py-0.5 transition-colors disabled:opacity-50 ${
                  props.mode === value
                    ? 'bg-background font-medium shadow-sm'
                    : 'text-muted-foreground hover:text-foreground'
                }`}
              >
                {label}
              </button>
            );
          })}
        </div>

        <label className="flex items-center gap-1 text-muted-foreground">
          <span className="sr-only">写入审批方式</span>
          <select
            value={props.approval}
            disabled={props.running}
            onChange={(event) => props.onApproval(event.target.value as ApprovalMode)}
            className="rounded-md bg-muted px-2 py-1 text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50"
          >
            <option value="ask">写入前询问我</option>
            <option value="readonly">只读（拒绝写入）</option>
          </select>
        </label>

        <span className="ml-auto flex min-w-0 items-center gap-2 text-muted-foreground">
          {props.balance && (
            <span
              title={props.balance.detail}
              className={
                props.balance.tone === 'low' ? 'text-red-600 dark:text-red-400' : undefined
              }
            >
              {props.balance.text}
            </span>
          )}
          <span className="truncate">{props.modelLabel}</span>
        </span>

        {props.running ? (
          <button
            type="button"
            onClick={props.onStop}
            aria-label="停止"
            className="flex size-8 items-center justify-center rounded-full bg-destructive text-white hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
          >
            <Square aria-hidden className="size-3.5 fill-current" />
          </button>
        ) : (
          <button
            type="button"
            onClick={props.onSend}
            disabled={!props.canSend}
            aria-label="发送"
            className="flex size-8 items-center justify-center rounded-full bg-primary text-primary-foreground transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none disabled:opacity-40"
          >
            <ArrowUp aria-hidden className="size-4" />
          </button>
        )}
      </div>
    </div>
  );
}
