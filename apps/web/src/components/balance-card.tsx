import { RefreshCw } from 'lucide-react';

import type { ModelBalance } from '@/api';
import { Button } from '@/components/ui/button';
import { formatMoney } from '@/lib/balance';

interface Props {
  balance: ModelBalance | null;
  loading: boolean;
  onRefresh: () => void;
}

/**
 * The account balance at the model provider, on the settings page. Where a provider has no balance
 * interface, or the lookup failed, it says so; it never shows a made-up zero.
 */
export function BalanceCard({ balance, loading, onRefresh }: Props) {
  return (
    <section aria-label="账户余额" className="rounded-xl border bg-card/50 p-3">
      <div className="flex items-center gap-2">
        <h2 className="text-sm font-medium">账户余额</h2>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="ml-auto"
          disabled={loading}
          onClick={onRefresh}
        >
          <RefreshCw aria-hidden className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          刷新
        </Button>
      </div>

      {balance === null && (
        <p className="mt-2 text-sm text-muted-foreground">{loading ? '查询中…' : '还没有查询到'}</p>
      )}

      {balance && balance.message && balance.balances.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">{balance.message}</p>
      )}

      {balance?.available === false && (
        <p role="alert" className="mt-2 text-sm text-red-600 dark:text-red-400">
          账户当前不能调用模型，请充值。
        </p>
      )}

      {balance && balance.balances.length > 0 && (
        <ul className="mt-2 space-y-2" aria-label="各币种余额">
          {balance.balances.map((line) => (
            <li key={line.currency}>
              <p className="text-2xl font-semibold tracking-tight">
                {formatMoney(line.currency, line.total)}
                <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                  {line.currency}
                </span>
              </p>
              <p className="text-xs text-muted-foreground">
                充值余额 {formatMoney(line.currency, line.toppedUp)} · 赠金{' '}
                {formatMoney(line.currency, line.granted)}
              </p>
            </li>
          ))}
        </ul>
      )}

      {balance && (
        <p className="mt-2 text-xs text-muted-foreground">
          数据来自服务商，可能有几分钟延迟 · 查询于{' '}
          {new Date(balance.checkedAt).toLocaleTimeString('zh-CN')}
        </p>
      )}
    </section>
  );
}
