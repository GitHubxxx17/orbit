import { ArrowUp, Folder, Square } from 'lucide-react';
import { useRef, type KeyboardEvent } from 'react';

import type { ApprovalMode, RunMode } from '@/api';
import { MenuSelect } from '@/components/menu-select';
import type { BalanceChip } from '@/lib/balance';
import type { ContextUse } from '@/lib/context-use';

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
  /** Registered workspaces to choose from, for a new conversation. */
  workspaces?: { id: string; name: string }[];
  workspaceId?: string | null;
  onWorkspaceChange?: (id: string) => void;
  /** A conversation keeps the workspace it started in, so the choice is closed once it exists. */
  workspaceLocked?: boolean;
  /** Name shown on the right: the live model, or the demo model. */
  modelLabel: string;
  /** The account balance next to the model name; null when there is nothing to show. */
  balance?: BalanceChip | null;
  /** How full the context window is; null when the window or the usage is not known. */
  contextUse?: ContextUse | null;
  /** Saved models to choose from; the picker shows only when there is more than one. */
  models?: { id: string; label: string }[];
  modelId?: string | null;
  onModelChange?: (id: string) => void;
  /** Agent profiles to choose from; the picker shows in live mode once the list has loaded. */
  agents?: { id: string; name: string }[];
  agentId?: string | null;
  onAgentChange?: (id: string) => void;
  placeholder: string;
}

const APPROVALS: { value: ApprovalMode; label: string }[] = [
  { value: 'ask', label: '写入前询问我' },
  { value: 'readonly', label: '只读（拒绝写入）' },
];

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
        {!props.workspaceLocked && (props.workspaces?.length ?? 0) > 1 && props.workspaceId ? (
          <MenuSelect<string>
            label="工作区"
            value={props.workspaceId}
            disabled={props.running}
            onChange={(id) => props.onWorkspaceChange?.(id)}
            options={props.workspaces?.map((w) => ({ value: w.id, label: w.name })) ?? []}
            className="max-w-40"
          />
        ) : (
          <span
            className="flex max-w-40 items-center gap-1 rounded-md bg-muted px-2 py-1 text-muted-foreground"
            title={`工作区：${props.workspaceName}`}
          >
            <Folder aria-hidden className="size-3.5 shrink-0" />
            <span className="truncate">{props.workspaceName}</span>
          </span>
        )}

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

        <MenuSelect<ApprovalMode>
          label="写入审批方式"
          value={props.approval}
          disabled={props.running}
          onChange={props.onApproval}
          options={APPROVALS}
        />

        {props.mode === 'live' && (props.agents?.length ?? 0) > 0 && props.agentId && (
          <MenuSelect<string>
            label="智能体"
            value={props.agentId}
            disabled={props.running}
            onChange={(id) => props.onAgentChange?.(id)}
            options={props.agents?.map((a) => ({ value: a.id, label: a.name })) ?? []}
            className="max-w-40"
          />
        )}

        <span className="ml-auto flex min-w-0 items-center gap-2 text-muted-foreground">
          {props.contextUse && (
            <span
              title={props.contextUse.detail}
              className={
                props.contextUse.tone === 'full'
                  ? 'text-red-600 dark:text-red-400'
                  : props.contextUse.tone === 'high'
                    ? 'text-amber-600 dark:text-amber-400'
                    : undefined
              }
            >
              上下文 {props.contextUse.percent}%
            </span>
          )}
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
          {props.mode === 'live' && (props.models?.length ?? 0) > 1 && props.modelId ? (
            <MenuSelect<string>
              label="模型"
              value={props.modelId}
              disabled={props.running}
              onChange={(id) => props.onModelChange?.(id)}
              options={props.models?.map((m) => ({ value: m.id, label: m.label })) ?? []}
              className="max-w-44"
            />
          ) : (
            <span className="truncate">{props.modelLabel}</span>
          )}
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
