/** "刚刚", "5 分钟前", "昨天"... for a timestamp in epoch milliseconds. */
export function relativeTime(timestamp: number, now: number = Date.now()): string {
  const seconds = Math.max(0, Math.floor((now - timestamp) / 1000));
  if (seconds < 45) return '刚刚';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${Math.max(1, minutes)} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  if (days === 1) return '昨天';
  if (days < 30) return `${days} 天前`;
  return new Date(timestamp).toLocaleDateString('zh-CN');
}

/** "27 秒", "1 分 05 秒" for a length of time in milliseconds. */
export function duration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1000));
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes} 分 ${String(seconds % 60).padStart(2, '0')} 秒`;
}

/** "812", "12.3k", "1.2M" for a number of tokens. */
export function formatTokens(count: number): string {
  if (count < 1000) return String(count);
  // One decimal. Rounding can reach 1000k, which is shown as 1.0M instead.
  const thousands = Math.round(count / 100) / 10;
  if (thousands < 1000) return `${thousands.toFixed(1)}k`;
  return `${(Math.round(count / 100_000) / 10).toFixed(1)}M`;
}

/** The wall-clock time of day, like 09:05:07, in the viewer's time zone. */
export function formatClock(timestamp: number): string {
  const date = new Date(timestamp);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(date.getHours())}:${two(date.getMinutes())}:${two(date.getSeconds())}`;
}

/** A date and time for a list, like 2026年9月30日，16:39, in the viewer's time zone. */
export function formatDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}年${date.getMonth() + 1}月${date.getDate()}日，${two(date.getHours())}:${two(date.getMinutes())}`;
}
