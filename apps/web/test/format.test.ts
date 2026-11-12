import { describe, expect, it } from 'vitest';

import { duration, relativeTime } from '@/lib/format';

const NOW = Date.UTC(2026, 10, 12, 12, 0, 0);
const ago = (ms: number) => NOW - ms;
const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

describe('relativeTime', () => {
  it.each([
    [10 * SECOND, '刚刚'],
    [44 * SECOND, '刚刚'],
    [90 * SECOND, '1 分钟前'],
    [5 * MINUTE, '5 分钟前'],
    [3 * HOUR, '3 小时前'],
    [DAY + HOUR, '昨天'],
    [4 * DAY, '4 天前'],
  ])('%d ms ago -> %s', (elapsed, expected) => {
    expect(relativeTime(ago(elapsed), NOW)).toBe(expected);
  });

  it('treats a time in the future as just now', () => {
    expect(relativeTime(NOW + HOUR, NOW)).toBe('刚刚');
  });

  it('falls back to a date for old timestamps', () => {
    expect(relativeTime(ago(60 * DAY), NOW)).toMatch(/\d{4}/);
  });
});

describe('duration', () => {
  it.each([
    [0, '0 秒'],
    [27_400, '27 秒'],
    [59_400, '59 秒'],
    [65_000, '1 分 05 秒'],
    [600_000, '10 分 00 秒'],
  ])('%d ms -> %s', (ms, expected) => {
    expect(duration(ms)).toBe(expected);
  });
});
