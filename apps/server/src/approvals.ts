import type { ApprovalAnswers, ApprovalRequest, Approver } from '@orbit/core';

/** What the HTTP layer needs: hand the user's answer to the run that is waiting for it. */
export interface ApprovalResolver {
  /** `unknown` when nothing is waiting (already answered, cancelled, or never asked). */
  resolve(
    runId: string,
    approvalId: string,
    answers: ApprovalAnswers,
  ): 'ok' | 'unknown' | 'invalid';
}

interface Pending {
  callIds: Set<string>;
  resolve(answers: ApprovalAnswers): void;
}

/**
 * Connects a run that is waiting for approval to the HTTP request that answers it. The run's
 * `request` promise stays open until someone calls `resolve`, or the run is cancelled.
 */
export class ApprovalBroker implements Approver, ApprovalResolver {
  private readonly pending = new Map<string, Pending>();

  private static key(runId: string, approvalId: string): string {
    return `${runId}:${approvalId}`;
  }

  request(request: ApprovalRequest, signal?: AbortSignal): Promise<ApprovalAnswers> {
    const key = ApprovalBroker.key(request.runId, request.approvalId);
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(new Error('aborted'));

      const onAbort = () => {
        this.pending.delete(key);
        reject(new Error('aborted'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      this.pending.set(key, {
        callIds: new Set(request.items.map((item) => item.callId)),
        resolve: (answers) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(answers);
        },
      });
    });
  }

  resolve(
    runId: string,
    approvalId: string,
    answers: ApprovalAnswers,
  ): 'ok' | 'unknown' | 'invalid' {
    const key = ApprovalBroker.key(runId, approvalId);
    const entry = this.pending.get(key);
    if (!entry) return 'unknown';
    // Answers about calls that were never asked are a sign of a confused or hostile client.
    if (Object.keys(answers).some((callId) => !entry.callIds.has(callId))) return 'invalid';

    this.pending.delete(key);
    entry.resolve(answers);
    return 'ok';
  }
}
