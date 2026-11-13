import type { BalanceLine, ModelBalance } from '@orbit/protocol';

const SYMBOL: Record<string, string> = { CNY: '¥', USD: '$' };

/** "¥2.13" for CNY, "$1.50" for USD, "EUR 3.00" for a currency without a symbol here. */
export function formatMoney(currency: string, amount: string): string {
  const symbol = SYMBOL[currency];
  return symbol ? `${symbol}${amount}` : `${currency} ${amount}`;
}

/** The total of every currency the account holds, such as "¥2.13" or "$1.50 · ¥2.13". */
export function totalText(lines: readonly BalanceLine[]): string {
  return lines.map((line) => formatMoney(line.currency, line.total)).join(' · ');
}

/** The split between topped-up money and gift credit, for a tooltip or a detail view. */
export function breakdownText(lines: readonly BalanceLine[]): string {
  return lines
    .map(
      (line) =>
        `充值 ${formatMoney(line.currency, line.toppedUp)} · 赠金 ${formatMoney(line.currency, line.granted)}`,
    )
    .join('；');
}

export interface BalanceChip {
  text: string;
  /** `low`: the account cannot make calls, or has nothing left. */
  tone: 'ok' | 'low';
  detail: string;
}

/**
 * What the small chip next to the model name shows. Nothing for a provider with no balance
 * interface, or when the lookup failed: a chip that guesses would be worse than none. The settings
 * page shows the reason.
 */
export function balanceChip(balance: ModelBalance | null): BalanceChip | null {
  if (!balance?.supported) return null;
  if (balance.available === false) {
    return { text: '余额不足', tone: 'low', detail: '账户当前不能调用模型，请充值' };
  }
  if (balance.balances.length === 0) return null;
  const empty = balance.balances.every((line) => Number(line.total) <= 0);
  return {
    text: totalText(balance.balances),
    tone: empty ? 'low' : 'ok',
    detail: breakdownText(balance.balances),
  };
}
