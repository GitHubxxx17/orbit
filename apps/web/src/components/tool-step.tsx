import { Ban, CircleCheck, CircleX, LoaderCircle, type LucideIcon } from 'lucide-react';
import { memo } from 'react';

import { describeTool } from '@/state/describe';
import type { ToolCard, ToolStatus } from '@/state/timeline';

const STATUS: Record<ToolStatus, { label: string; className: string; icon: LucideIcon }> = {
  pending: { label: '等待策略', className: 'text-muted-foreground', icon: LoaderCircle },
  running: { label: '执行中', className: 'text-sky-400', icon: LoaderCircle },
  done: { label: '成功', className: 'text-emerald-400', icon: CircleCheck },
  failed: { label: '失败', className: 'text-amber-400', icon: CircleX },
  denied: { label: '已拒绝', className: 'text-red-400', icon: Ban },
};

const MAX_OUTPUT_LINES = 12;

function ToolStepView({ card }: { card: ToolCard }) {
  const { label, className, icon: Icon } = STATUS[card.status];
  const spinning = card.status === 'pending' || card.status === 'running';
  const lines = card.output?.split('\n') ?? [];
  const shown = lines.slice(0, MAX_OUTPUT_LINES).join('\n');

  return (
    <li className="py-1.5 text-sm">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md px-1 py-0.5 hover:bg-muted/50 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
          <Icon
            aria-hidden
            className={`size-4 shrink-0 ${className} ${spinning ? 'animate-spin' : ''}`}
          />
          <span className="truncate">{describeTool(card.tool, card.args)}</span>
          <span className={`ml-auto shrink-0 text-xs ${className}`}>{label}</span>
        </summary>

        <div className="mt-2 ml-6 space-y-2">
          <p className="font-mono text-xs text-muted-foreground">
            {card.tool} · 风险 {card.risk}
          </p>
          <pre className="overflow-x-auto rounded-md bg-muted/50 p-2 font-mono text-xs">
            {JSON.stringify(card.args)}
          </pre>
          {card.output !== undefined && (
            <pre
              className="max-h-56 overflow-auto rounded-md bg-muted/50 p-2 font-mono text-xs whitespace-pre-wrap"
              tabIndex={0}
              aria-label={`${card.tool} 的输出`}
            >
              {shown}
              {lines.length > MAX_OUTPUT_LINES
                ? `\n… 还有 ${lines.length - MAX_OUTPUT_LINES} 行`
                : ''}
            </pre>
          )}
        </div>
      </details>

      {card.status === 'denied' && (
        <p className="mt-1 ml-7 text-xs text-red-400">
          策略（{card.decidedBy ?? 'policy'}）没有放行，工具没有被执行。
        </p>
      )}
    </li>
  );
}

// Streaming re-renders the list often; a step only changes when its own data changes.
export const ToolStep = memo(ToolStepView);
