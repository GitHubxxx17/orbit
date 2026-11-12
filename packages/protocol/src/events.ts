import { z } from 'zod';

/**
 * Every fact about an agent run is an immutable, append-only event.
 * Replay, fork, rollback and observability are all derived from this log.
 */
const base = {
  id: z.string().min(1),
  runId: z.string().min(1),
  /** Monotonic per-run sequence number, starting at 1. */
  seq: z.number().int().positive(),
  /** Unix epoch milliseconds. */
  ts: z.number().int().nonnegative(),
};

export const RiskLevel = z.enum(['read', 'write', 'dangerous']);
export type RiskLevel = z.infer<typeof RiskLevel>;

export const OrbitEvent = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('run.started'),
    agentId: z.string().min(1),
    workspace: z.string().min(1),
  }),
  z.object({ ...base, type: z.literal('message.delta'), text: z.string() }),
  z.object({
    ...base,
    type: z.literal('tool.requested'),
    callId: z.string().min(1),
    tool: z.string().min(1),
    args: z.record(z.string(), z.unknown()),
    risk: RiskLevel,
  }),
  z.object({
    ...base,
    type: z.literal('tool.decided'),
    callId: z.string().min(1),
    decision: z.enum(['allow', 'deny']),
    by: z.enum(['policy', 'user']),
  }),
  /**
   * The policy could not decide alone, so the run pauses until the user does. One event covers
   * every call of a model turn that needs approval, so the user reviews them together.
   */
  z.object({
    ...base,
    type: z.literal('approval.requested'),
    approvalId: z.string().min(1),
    items: z
      .array(
        z.object({
          callId: z.string().min(1),
          /** What would change, as a unified diff or a short description. */
          preview: z.string(),
        }),
      )
      .min(1),
  }),
  z.object({
    ...base,
    type: z.literal('tool.result'),
    callId: z.string().min(1),
    ok: z.boolean(),
    output: z.string(),
  }),
  z.object({ ...base, type: z.literal('run.completed') }),
  z.object({ ...base, type: z.literal('run.failed'), reason: z.string() }),
]);
export type OrbitEvent = z.infer<typeof OrbitEvent>;
export type OrbitEventType = OrbitEvent['type'];
