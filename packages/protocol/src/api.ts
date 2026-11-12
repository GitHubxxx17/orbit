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

/** Where the model settings in effect came from. */
export const ModelSource = z.enum(['settings', 'env', 'none']);
export type ModelSource = z.infer<typeof ModelSource>;

/**
 * The model settings as the server reports them. The API key is never part of it: only whether
 * one exists and its last characters, so the user can tell which key is in use.
 */
export const ModelStatus = z.object({
  configured: z.boolean(),
  source: ModelSource,
  baseUrl: z.string().nullable(),
  model: z.string().nullable(),
  apiKeyHint: z.string().nullable(),
});
export type ModelStatus = z.infer<typeof ModelStatus>;

/** What the settings page sends. `apiKey` may be left out to keep the stored one. */
export const ModelInput = z.object({
  baseUrl: z.string().trim().min(1).max(300),
  model: z.string().trim().min(1).max(100),
  apiKey: z.string().trim().min(1).max(500).optional(),
});
export type ModelInput = z.infer<typeof ModelInput>;

/** Result of trying the model with a tiny request. `message` never contains the key. */
export const ModelTestResult = z.object({
  ok: z.boolean(),
  message: z.string(),
  latencyMs: z.number().int().nonnegative().nullable(),
});
export type ModelTestResult = z.infer<typeof ModelTestResult>;
