import { z } from 'zod';

import { RiskLevel } from './events.js';

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
  /** The folder the conversation works in, as its first run recorded it; empty if unknown. */
  workspace: z.string(),
  /** The registered name of that workspace, or the folder's own name if it is not registered. */
  workspaceName: z.string(),
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
 * One saved model as the server reports it. The API key is never part of it: only its last
 * characters, so the user can tell which key is in use.
 */
export const ModelProfile = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  baseUrl: z.string(),
  model: z.string(),
  apiKeyHint: z.string(),
  /** `env` is the fallback from .env: it cannot be edited or removed, only replaced. */
  source: ModelSource.exclude(['none']),
});
export type ModelProfile = z.infer<typeof ModelProfile>;

/** Every model that can be chosen, and the one new conversations start with (null if none). */
export const ModelList = z.object({
  models: z.array(ModelProfile),
  defaultId: z.string().nullable(),
});
export type ModelList = z.infer<typeof ModelList>;

/**
 * What the settings page sends for one model. `apiKey` may be left out to keep the stored one
 * (when the model already exists). `label` defaults to the model name.
 */
export const ModelInput = z.object({
  label: z.string().trim().min(1).max(60).optional(),
  baseUrl: z.string().trim().min(1).max(300),
  model: z.string().trim().min(1).max(100),
  apiKey: z.string().trim().min(1).max(500).optional(),
});
export type ModelInput = z.infer<typeof ModelInput>;

/** A connection test: the form values, plus the saved model whose key to use if none is typed. */
export const ModelTestInput = ModelInput.extend({ id: z.string().min(1).optional() });
export type ModelTestInput = z.infer<typeof ModelTestInput>;

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

/**
 * An agent profile: a name for a way of working. It picks a model, adds instructions to the
 * built-in system prompt and may narrow the tools. It can only narrow: policy, sandbox and approval
 * apply to every agent in the same way.
 */
export const AgentProfile = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  description: z.string(),
  /** Extra instructions appended to the built-in system prompt; empty for none. */
  instructions: z.string(),
  /** A saved model to use, or null for whichever the user picks / the default. */
  modelId: z.string().nullable(),
  /** The tools this agent may call, or null for all of them. `report` is always available. */
  tools: z.array(z.string()).nullable(),
  /** The built-in agent can be chosen but not edited or removed. */
  builtin: z.boolean(),
});
export type AgentProfile = z.infer<typeof AgentProfile>;

export const AgentList = z.object({ agents: z.array(AgentProfile) });
export type AgentList = z.infer<typeof AgentList>;

/** What the settings page sends for one agent. */
export const AgentInput = z.object({
  name: z.string().trim().min(1).max(40),
  description: z.string().trim().max(200).optional(),
  instructions: z.string().trim().max(4000).optional(),
  modelId: z.string().min(1).nullable().optional(),
  tools: z.array(z.string().min(1).max(200)).max(200).nullable().optional(),
});
export type AgentInput = z.infer<typeof AgentInput>;

/** One tool an agent may be given, as the agent editor lists it. */
export const ToolInfo = z.object({
  name: z.string().min(1),
  risk: RiskLevel,
  description: z.string(),
});
export type ToolInfo = z.infer<typeof ToolInfo>;

export const ToolList = z.object({ tools: z.array(ToolInfo) });
export type ToolList = z.infer<typeof ToolList>;

/** A folder the agent may work in. Only the server decides which exist (ADR 0014). */
export const WorkspaceInfo = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  path: z.string().min(1),
});
export type WorkspaceInfo = z.infer<typeof WorkspaceInfo>;

/** The registered workspaces, the one used by default, and entries of the config that were skipped. */
export const WorkspaceList = z.object({
  workspaces: z.array(WorkspaceInfo),
  defaultId: z.string().min(1),
  errors: z.array(z.object({ source: z.string(), message: z.string() })),
});
export type WorkspaceList = z.infer<typeof WorkspaceList>;

/** The list after a folder was chosen in the dialog; `added` is null when the user cancelled. */
export const WorkspaceAdded = WorkspaceList.extend({ added: WorkspaceInfo.nullable() });
export type WorkspaceAdded = z.infer<typeof WorkspaceAdded>;
