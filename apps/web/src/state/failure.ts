import { EARLY_STOP_PREFIX } from '@orbit/protocol';

/**
 * How a failed run is shown. A run that Orbit stopped itself, after asking the model for an answer
 * from what it had gathered, is not the same as one that broke: the answer is on screen, and the
 * notice only says it may be incomplete.
 */
export interface FailureNotice {
  /** `early`: stopped on purpose, an answer exists. `error`: something went wrong. */
  kind: 'early' | 'error';
  text: string;
}

const EARLY_TEXT: Record<string, string> = {
  loop: '智能体在重复同一个调用并得到同样的结果，已提前结束。上面的回答只基于它已经读到的内容，可能不完整。',
  steps:
    '已达到安全上限（模型调用次数过多），已提前结束。上面的回答只基于它已经读到的内容，可能不完整。',
};

export function describeFailure(reason: string | null): FailureNotice {
  if (reason?.startsWith(EARLY_STOP_PREFIX)) {
    const why = reason.slice(EARLY_STOP_PREFIX.length);
    return {
      kind: 'early',
      text: EARLY_TEXT[why] ?? '已提前结束。上面的回答可能不完整。',
    };
  }
  return { kind: 'error', text: `运行失败：${reason ?? '未知原因'}` };
}
