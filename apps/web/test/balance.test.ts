import type { ModelBalance } from '@orbit/protocol';
import { describe, expect, it } from 'vitest';

import { balanceChip, breakdownText, formatMoney, totalText } from '@/lib/balance';

const line = (currency: string, total: string, granted = '0.00', toppedUp = total) => ({
  currency,
  total,
  granted,
  toppedUp,
});

const balance = (over: Partial<ModelBalance> = {}): ModelBalance => ({
  supported: true,
  available: true,
  balances: [line('CNY', '2.13')],
  message: null,
  checkedAt: 1,
  ...over,
});

describe('formatMoney', () => {
  it('uses a symbol for the currencies it knows and the code for the rest', () => {
    expect(formatMoney('CNY', '2.13')).toBe('¥2.13');
    expect(formatMoney('USD', '1.50')).toBe('$1.50');
    expect(formatMoney('EUR', '3.00')).toBe('EUR 3.00');
  });

  it('keeps the amount exactly as the provider wrote it', () => {
    expect(formatMoney('CNY', '110.000')).toBe('¥110.000');
  });
});

describe('totalText and breakdownText', () => {
  const lines = [line('USD', '1.50', '0.50', '1.00'), line('CNY', '2.13', '0.13', '2.00')];

  it('joins every currency the account holds', () => {
    expect(totalText(lines)).toBe('$1.50 · ¥2.13');
  });

  it('splits topped-up money from gift credit', () => {
    expect(breakdownText(lines)).toBe('充值 $1.00 · 赠金 $0.50；充值 ¥2.00 · 赠金 ¥0.13');
  });
});

describe('balanceChip', () => {
  it('shows the total with the split as its detail', () => {
    expect(balanceChip(balance())).toEqual({
      text: '¥2.13',
      tone: 'ok',
      detail: '充值 ¥2.13 · 赠金 ¥0.00',
    });
  });

  it('warns when the account cannot make calls', () => {
    expect(balanceChip(balance({ available: false, balances: [] }))).toMatchObject({
      text: '余额不足',
      tone: 'low',
    });
  });

  it('warns when everything is used up even if the provider still says available', () => {
    expect(balanceChip(balance({ balances: [line('CNY', '0.00')] }))?.tone).toBe('low');
  });

  it('shows nothing rather than guess: no data yet, unsupported, or a failed lookup', () => {
    expect(balanceChip(null)).toBeNull();
    expect(balanceChip(balance({ supported: false, available: null, balances: [] }))).toBeNull();
    expect(
      balanceChip(balance({ available: null, balances: [], message: '查询余额失败（HTTP 500）' })),
    ).toBeNull();
  });
});
