import { z } from 'zod';

/**
 * Shapes the HTTP API returns, shared by the server and the web app so neither guesses at the
 * other's output. The client parses every response with these before using it.
 */

export const SessionStatus = z.enum(['running', 'awaiting', 'failed', 'idle']);
export type SessionStatus = z.infer<typeof SessionStatus>;

/** One line of the session list. Everything in it is derived from the event logs. */
export const SessionSummary = z.object({
  sessionId: z.string().min(1),
  title: z.string(),
  snippet: z.string(),
  runCount: z.number().int().nonnegative(),
  status: SessionStatus,
  /** Unix epoch milliseconds of the session's last event. */
  updatedAt: z.number().int().nonnegative(),
});
export type SessionSummary = z.infer<typeof SessionSummary>;

export const SessionList = z.object({ sessions: z.array(SessionSummary) });

export const SessionRuns = z.object({
  sessionId: z.string().min(1),
  runIds: z.array(z.string().min(1)),
});

export const RunMode = z.enum(['demo', 'live']);
export type RunMode = z.infer<typeof RunMode>;

export const ServerInfo = z.object({
  workspace: z.string(),
  workspaceName: z.string(),
  /** The model behind live mode, or null when live mode is not configured. */
  liveModel: z.string().nullable(),
  modes: z.array(RunMode),
});
export type ServerInfo = z.infer<typeof ServerInfo>;
