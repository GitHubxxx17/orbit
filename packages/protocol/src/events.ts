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
    /** The model name for a live run; absent in older logs and for the demo model. */
    model: z.string().min(1).optional(),
    /** The name of the agent profile the run used; absent for the built-in agent and old logs. */
    agentName: z.string().min(1).optional(),
  }),
  /** What the user asked in this run; recorded so history can be rebuilt from the log alone. */
  z.object({ ...base, type: z.literal('user.message'), text: z.string().min(1) }),
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
  /**
   * A tool really changed a file. Keeps both versions of the text so the change can be undone later
   * (rollback) and so it is auditable. `before` is null when the file did not exist.
   */
  z.object({
    ...base,
    type: z.literal('file.changed'),
    callId: z.string().min(1),
    /** Workspace-relative path, forward slashes. */
    path: z.string().min(1),
    before: z.string().nullable(),
    after: z.string(),
  }),
  /**
   * The user undid a `file.changed`. The only event allowed after a run's terminal event, because
   * a rollback happens long after the run ended. Appended, never an edit of the original.
   */
  z.object({
    ...base,
    type: z.literal('file.rolledback'),
    callId: z.string().min(1),
    path: z.string().min(1),
  }),
  /**
   * What one model call cost, as the provider reported it. Appended after the call finishes. Absent
   * when the provider does not report usage (and for the scripted demo model), so a missing event
   * means "unknown", never zero.
   */
  z.object({
    ...base,
    type: z.literal('model.usage'),
    promptTokens: z.number().int().nonnegative(),
    completionTokens: z.number().int().nonnegative(),
  }),
  z.object({ ...base, type: z.literal('run.completed') }),
  z.object({ ...base, type: z.literal('run.failed'), reason: z.string() }),
]);
export type OrbitEvent = z.infer<typeof OrbitEvent>;
export type OrbitEventType = OrbitEvent['type'];

/**
 * A run that Orbit ended itself, after asking the model for a final answer from what it had
 * gathered, fails with `stopped early: <why>`. The answer is in the log; the reason says it may be
 * incomplete. `<why>` is `loop` (the same call kept returning the same result) or `steps` (the
 * safety ceiling on model calls was reached).
 */
export const EARLY_STOP_PREFIX = 'stopped early: ';
