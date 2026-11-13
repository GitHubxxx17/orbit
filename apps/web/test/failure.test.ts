import { EARLY_STOP_PREFIX } from '@orbit/protocol';
import { describe, expect, it } from 'vitest';

import { describeFailure } from '@/state/failure';

describe('describeFailure', () => {
  it('shows a run stopped for repeating itself as an early stop, not an error', () => {
    const notice = describeFailure(`${EARLY_STOP_PREFIX}loop`);
    expect(notice.kind).toBe('early');
    expect(notice.text).toContain('重复同一个调用');
    expect(notice.text).toContain('可能不完整');
  });

  it('shows the safety ceiling as an early stop too', () => {
    expect(describeFailure(`${EARLY_STOP_PREFIX}steps`)).toMatchObject({ kind: 'early' });
  });

  it('still says something sensible for a reason it does not know', () => {
    expect(describeFailure(`${EARLY_STOP_PREFIX}something-new`)).toMatchObject({ kind: 'early' });
  });

  it('adds a plain hint after a rate-limit error and keeps the provider’s own text', () => {
    const reason = 'model error: LLM request failed with status 429: {"error":{"code":"1305"}}';
    const notice = describeFailure(reason);
    expect(notice.kind).toBe('error');
    expect(notice.text).toContain(reason);
    expect(notice.text).toContain('稍后重试');
  });

  it('keeps every other failure an error and shows its reason', () => {
    expect(describeFailure('model error: fetch failed')).toEqual({
      kind: 'error',
      text: '运行失败：model error: fetch failed',
    });
    expect(describeFailure('cancelled')).toMatchObject({ kind: 'error' });
    expect(describeFailure(null)).toEqual({ kind: 'error', text: '运行失败：未知原因' });
  });
});
