import type { EvidenceCheck, EvidenceStatus, Verdict } from '@orbit/protocol';
import { ClipboardCheck } from 'lucide-react';
import { useId } from 'react';

import { describeTool } from '@/state/describe';
import type { ReportView } from '@/state/report';
import type { ToolCard } from '@/state/timeline';

const MAX_OUTPUT_CHARS = 800;

const VERDICT: Record<Verdict, { label: string; bar: string; badge: string }> = {
  supported: {
    label: '有证据',
    bar: 'border-l-emerald-500',
    badge: 'text-emerald-700 dark:text-emerald-400',
  },
  partial: {
    label: '部分有证据',
    bar: 'border-l-amber-500',
    badge: 'text-amber-700 dark:text-amber-400',
  },
  unsupported: {
    label: '无证据',
    bar: 'border-l-red-500',
    badge: 'text-red-700 dark:text-red-400',
  },
};

const EVIDENCE: Record<EvidenceStatus, string> = {
  ok: '成功',
  failed: '调用失败',
  denied: '被拒绝，没有执行',
  unfinished: '还没有结束',
  unknown: '本次运行里没有这个调用',
  invalid: '不能作为证据',
};

function Evidence({ item, card }: { item: EvidenceCheck; card: ToolCard | undefined }) {
  const good = item.status === 'ok';
  const label = card ? describeTool(card.tool, card.args) : `调用 ${item.callId}`;
  const output = card?.output ?? '';
  return (
    <details className="group rounded-md border bg-background/60">
      <summary className="flex cursor-pointer list-none items-center gap-2 px-2 py-1 text-xs focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none">
        <span
          className={
            good ? 'text-emerald-600 dark:text-emerald-400' : 'text-red-600 dark:text-red-400'
          }
          aria-hidden
        >
          {good ? '✓' : '✗'}
        </span>
        <span className="truncate">{label}</span>
        <span className="ml-auto shrink-0 text-muted-foreground">{EVIDENCE[item.status]}</span>
      </summary>
      <div className="space-y-1 border-t px-2 py-2 text-xs">
        <p className="font-mono text-muted-foreground">
          {item.tool ?? '未知工具'} · {item.callId}
        </p>
        {output !== '' && (
          <pre className="max-h-48 overflow-auto rounded bg-muted p-2 font-mono text-[11px] whitespace-pre-wrap">
            {output.length > MAX_OUTPUT_CHARS ? `${output.slice(0, MAX_OUTPUT_CHARS)}…` : output}
          </pre>
        )}
      </div>
    </details>
  );
}

/**
 * The agent's conclusions, each with the tool calls it cites. A conclusion is only "有证据" when
 * every cited call really ran and succeeded; the check does not read the claim's wording, so a
 * green mark means "backed by a real call", not "proven true".
 */
export function ReportCard({
  report,
  tools,
}: {
  report: ReportView;
  tools: Record<string, ToolCard>;
}) {
  const headingId = useId();
  const { tally, checks } = report;
  const unverified = tally.partial + tally.unsupported;

  return (
    <section aria-labelledby={headingId} className="my-3 rounded-xl border bg-card/50 p-3">
      <h2 id={headingId} className="flex flex-wrap items-center gap-2 text-sm font-medium">
        <ClipboardCheck aria-hidden className="size-4 text-sky-600 dark:text-sky-400" />
        报告 · {checks.length} 条结论
        <span className="text-xs font-normal text-emerald-700 dark:text-emerald-400">
          {tally.supported} 有证据
        </span>
        {unverified > 0 && (
          <span className="text-xs font-normal text-red-700 dark:text-red-400">
            {unverified} 条未被证实
          </span>
        )}
      </h2>

      <ul className="mt-3 space-y-3">
        {checks.map((check, index) => {
          const verdict = VERDICT[check.verdict];
          return (
            <li key={index} className={`border-l-4 pl-3 ${verdict.bar}`}>
              <p className="text-sm">
                <span className={`mr-2 text-xs font-medium ${verdict.badge}`}>{verdict.label}</span>
                {check.text}
              </p>
              {check.evidence.length > 0 && (
                <ul className="mt-1.5 space-y-1" aria-label="引用的工具调用">
                  {check.evidence.map((item) => (
                    <li key={item.callId}>
                      <Evidence item={item} card={tools[item.callId]} />
                    </li>
                  ))}
                </ul>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
