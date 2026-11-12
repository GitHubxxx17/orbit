import type { OrbitEvent } from '@orbit/protocol';

export type ViolationCode =
  | 'seq-gap'
  | 'missing-run-started'
  | 'event-after-terminal'
  | 'decision-without-request'
  | 'duplicate-decision'
  | 'result-without-allow'
  | 'approval-unknown-call'
  | 'user-decision-without-approval'
  | 'unresolved-tool-call';

export interface Violation {
  code: ViolationCode;
  /** The seq of the offending event; 0 when the problem is about the log as a whole. */
  seq: number;
  message: string;
}

/**
 * Check a run's event log against the invariants in docs/architecture.md.
 * Returns every violation found; an empty array means the log is consistent.
 */
export function checkInvariants(events: readonly OrbitEvent[]): Violation[] {
  const violations: Violation[] = [];
  const add = (code: ViolationCode, seq: number, message: string) =>
    violations.push({ code, seq, message });

  const requested = new Set<string>();
  const approvalAsked = new Set<string>();
  const decision = new Map<string, 'allow' | 'deny'>();
  const resolved = new Set<string>();
  let terminalSeq: number | null = null;

  events.forEach((event, index) => {
    if (event.seq !== index + 1) {
      add('seq-gap', event.seq, `expected seq ${index + 1} but found ${event.seq}`);
    }
    if (index === 0 && event.type !== 'run.started') {
      add('missing-run-started', event.seq, 'the first event of a run must be run.started');
    }
    if (terminalSeq !== null) {
      add('event-after-terminal', event.seq, `event after terminal event at seq ${terminalSeq}`);
    }

    switch (event.type) {
      case 'tool.requested':
        requested.add(event.callId);
        break;
      case 'approval.requested':
        for (const item of event.items) {
          if (requested.has(item.callId)) approvalAsked.add(item.callId);
          else add('approval-unknown-call', event.seq, `no request for call ${item.callId}`);
        }
        break;
      case 'tool.decided':
        if (event.by === 'user' && !approvalAsked.has(event.callId)) {
          add(
            'user-decision-without-approval',
            event.seq,
            `call ${event.callId} was decided by the user but never put up for approval`,
          );
        }
        if (!requested.has(event.callId)) {
          add('decision-without-request', event.seq, `no request for call ${event.callId}`);
        } else if (decision.has(event.callId)) {
          add('duplicate-decision', event.seq, `call ${event.callId} was already decided`);
        } else {
          decision.set(event.callId, event.decision);
          if (event.decision === 'deny') resolved.add(event.callId);
        }
        break;
      case 'tool.result':
        if (decision.get(event.callId) !== 'allow') {
          add('result-without-allow', event.seq, `call ${event.callId} has no allow decision`);
        } else {
          resolved.add(event.callId);
        }
        break;
      case 'run.completed':
      case 'run.failed':
        terminalSeq ??= event.seq;
        break;
      default:
        break;
    }
  });

  // A finished run must not leave tool calls hanging. A run still in progress may.
  if (terminalSeq !== null) {
    for (const callId of requested) {
      if (!resolved.has(callId)) {
        add('unresolved-tool-call', terminalSeq, `call ${callId} never reached a final state`);
      }
    }
  }
  return violations;
}
