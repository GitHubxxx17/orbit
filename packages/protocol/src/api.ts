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

/** What forking a conversation returns: the id of the new conversation. */
export const ForkResult = z.object({ sessionId: z.string().min(1) });
export type ForkResult = z.infer<typeof ForkResult>;

/** One tool offered by an MCP server, as the settings page lists it. */
export const McpToolInfo = z.object({
  /** The name the model sees: `mcp__<server>__<tool>`. */
  name: z.string().min(1),
  /** read: runs without asking (the user listed it as read-only). write: asks every turn. */
  risk: z.enum(['read', 'write']),
  description: z.string(),
});
export type McpToolInfo = z.infer<typeof McpToolInfo>;

export const McpServerInfo = z.object({
  id: z.string().min(1),
  transport: z.enum(['stdio', 'http']),
  state: z.enum(['connected', 'failed', 'disabled']),
  /** Why it failed, with secrets removed; null unless failed. */
  error: z.string().nullable(),
  tools: z.array(McpToolInfo),
  /** Tools that were offered but not used, and why (for example an unusable name). */
  skipped: z.array(z.string()),
});
export type McpServerInfo = z.infer<typeof McpServerInfo>;

/** The configured MCP servers. Read-only: the config is a file the user edits by hand. */
export const McpStatus = z.object({
  servers: z.array(McpServerInfo),
  /** Set when mcp.json could not be used at all (unreadable or invalid); no server was started. */
  configError: z.string().nullable(),
});
export type McpStatus = z.infer<typeof McpStatus>;

/** One currency of an account balance. Amounts stay strings: money is not rounded by a float. */
export const BalanceLine = z.object({
  currency: z.string().min(1),
  total: z.string(),
  /** Gift credit that has not expired. */
  granted: z.string(),
  /** Money the user topped up. */
  toppedUp: z.string(),
});
export type BalanceLine = z.infer<typeof BalanceLine>;

/**
 * What the model provider says about the account's balance. Only some providers have such an
 * interface; for the others `supported` is false and `message` says why. A failed lookup is
 * `supported: true` with no lines and a message, never a made-up zero.
 */
export const ModelBalance = z.object({
  supported: z.boolean(),
  /** Whether the account can still make calls; null when the provider does not say. */
  available: z.boolean().nullable(),
  balances: z.array(BalanceLine),
  /** Why there are no numbers (unsupported, not configured, lookup failed); null otherwise. */
  message: z.string().nullable(),
  /** Epoch milliseconds of the lookup that produced this. */
  checkedAt: z.number().int().nonnegative(),
});
export type ModelBalance = z.infer<typeof ModelBalance>;
