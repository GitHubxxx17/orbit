import { Pause, Play, SkipBack, SkipForward, X } from 'lucide-react';
import { useId } from 'react';

import { Button } from '@/components/ui/button';
import type { ReplayStep } from '@/state/replay';

interface Props {
  step: number;
  total: number;
  current: ReplayStep | null;
  playing: boolean;
  onGoTo: (step: number) => void;
  onToggle: () => void;
  onExit: () => void;
}

/** Controls for stepping through a stored conversation. Takes the place of the input box. */
export function ReplayBar({ step, total, current, playing, onGoTo, onToggle, onExit }: Props) {
  const sliderId = useId();
  return (
    <section aria-label="回放控制" className="rounded-2xl border bg-card p-3 shadow-sm">
      <div className="flex items-center gap-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onGoTo(0)}
          disabled={step === 0}
          aria-label="回到开头"
        >
          <SkipBack aria-hidden className="size-4" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onGoTo(step - 1)}
          disabled={step === 0}
          aria-label="上一步"
        >
          <span aria-hidden className="text-base leading-none">
            ‹
          </span>
        </Button>
        <Button size="icon" onClick={onToggle} aria-label={playing ? '暂停' : '播放'}>
          {playing ? (
            <Pause aria-hidden className="size-4" />
          ) : (
            <Play aria-hidden className="size-4" />
          )}
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onGoTo(step + 1)}
          disabled={step >= total}
          aria-label="下一步"
        >
          <span aria-hidden className="text-base leading-none">
            ›
          </span>
        </Button>
        <Button
          variant="ghost"
          size="icon"
          onClick={() => onGoTo(total)}
          disabled={step >= total}
          aria-label="跳到结尾"
        >
          <SkipForward aria-hidden className="size-4" />
        </Button>

        <label htmlFor={sliderId} className="sr-only">
          回放进度
        </label>
        <input
          id={sliderId}
          type="range"
          min={0}
          max={total}
          value={step}
          onChange={(event) => onGoTo(Number(event.target.value))}
          className="mx-2 min-w-0 flex-1 accent-sky-500"
        />
        <span className="shrink-0 font-mono text-xs text-muted-foreground" aria-live="off">
          {step} / {total}
        </span>
        <Button variant="outline" size="sm" onClick={onExit}>
          <X aria-hidden className="size-3.5" />
          退出回放
        </Button>
      </div>
      <p className="mt-2 truncate text-xs text-muted-foreground" aria-live="polite">
        {current
          ? `第 ${current.turn + 1} 轮 · ${current.label}`
          : '回放只读取历史，不会运行任何东西'}
      </p>
    </section>
  );
}
