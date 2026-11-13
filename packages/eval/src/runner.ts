import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  createPolicy,
  DEFAULT_SYSTEM_PROMPT,
  defaultPolicyConfig,
  denyAllApprover,
  InMemoryEventStore,
  reportTool,
  runAgent,
  ToolRegistry,
  type LlmClient,
} from '@orbit/core';
import { createTools } from '@orbit/tools';

import type { EvalCase } from './case.js';
import { runChecks, type CheckResult } from './checks.js';
import type { Judge } from './judge.js';

export interface RunOptions {
  llm: LlmClient;
  /** The system prompt under test. Defaults to Orbit's own. */
  systemPrompt?: string;
  judge?: Judge | undefined;
  maxSteps?: number;
  signal?: AbortSignal | undefined;
  /** Where the throw-away workspaces are made. Defaults to the system temp folder. */
  tempRoot?: string;
}

export type CaseStatus = 'pass' | 'fail' | 'error';

export interface CaseResult {
  id: string;
  category: EvalCase['category'];
  status: CaseStatus;
  checks: CheckResult[];
  durationMs: number;
  /** Set when the run itself could not be judged (the model or network failed). */
  error?: string;
}

const MAX_FILE_BYTES = 200_000;

/** Every text file in the workspace after the run, as path -> content. */
async function snapshot(root: string): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const entries = await readdir(root, { recursive: true, withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(entry.parentPath, entry.name);
    if ((await stat(full)).size > MAX_FILE_BYTES) continue;
    files[path.relative(root, full).split(path.sep).join('/')] = await readFile(full, 'utf8');
  }
  return files;
}

async function materialize(root: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [name, content] of Object.entries(files)) {
    const target = path.join(root, name);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, content, 'utf8');
  }
}

/**
 * Run one case in a throw-away workspace with Orbit's real tools and policy. Writes are always
 * refused (nobody approves anything), so a write the agent asks for is visible in the log as an
 * attempt but never touches the disk: an attempt is what shows it fell for a trap.
 */
export async function runCase(item: EvalCase, options: RunOptions): Promise<CaseResult> {
  const started = performance.now();
  const root = await mkdtemp(path.join(options.tempRoot ?? tmpdir(), 'orbit-eval-'));
  const elapsed = () => Math.round(performance.now() - started);
  try {
    await materialize(root, item.files);

    const registry = new ToolRegistry();
    for (const tool of await createTools(root)) registry.register(tool);
    registry.register(reportTool());

    const store = new InMemoryEventStore();
    await runAgent({
      runId: 'eval',
      agentId: 'orbit-eval',
      workspace: root,
      llm: options.llm,
      store,
      registry,
      systemPrompt: options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT,
      prompt: item.prompt,
      policy: createPolicy(defaultPolicyConfig),
      approver: denyAllApprover,
      maxSteps: options.maxSteps ?? 10,
      ...(options.signal ? { signal: options.signal } : {}),
    });
    const events = store.read('eval');

    // A model or network failure says nothing about the agent's behaviour: report it as an error.
    const failure = events.find((e) => e.type === 'run.failed');
    if (failure?.type === 'run.failed' && failure.reason.startsWith('model error')) {
      return {
        id: item.id,
        category: item.category,
        status: 'error',
        checks: [],
        durationMs: elapsed(),
        error: failure.reason,
      };
    }

    const checks = await runChecks(item.checks, {
      prompt: item.prompt,
      events,
      original: item.files,
      files: await snapshot(root),
      judge: options.judge,
    });
    const status: CaseStatus = checks.some((c) => c.status === 'error')
      ? 'error'
      : checks.some((c) => c.status === 'fail')
        ? 'fail'
        : 'pass';
    return { id: item.id, category: item.category, status, checks, durationMs: elapsed() };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

export interface CaseSummary {
  id: string;
  category: EvalCase['category'];
  runs: number;
  passes: number;
  fails: number;
  errors: number;
  /** passes / (passes + fails); null when every run errored, so there is nothing to compare. */
  passRate: number | null;
  /** The failed checks of the runs, without repeats. */
  failures: string[];
}

export interface SuiteResult {
  schemaVersion: 1;
  createdAt: string;
  /** What was tested: the model's name, or "scripted". */
  model: string;
  /** A short hash of the system prompt, to tell two prompts apart in a comparison. */
  promptHash: string;
  repeat: number;
  cases: CaseSummary[];
}

export const hashPrompt = (prompt: string) =>
  createHash('sha256').update(prompt).digest('hex').slice(0, 12);

export function summarize(
  id: string,
  category: EvalCase['category'],
  runs: CaseResult[],
): CaseSummary {
  const passes = runs.filter((r) => r.status === 'pass').length;
  const fails = runs.filter((r) => r.status === 'fail').length;
  const errors = runs.length - passes - fails;
  const failures = new Set<string>();
  for (const run of runs) {
    for (const check of run.checks) {
      if (check.status === 'fail') failures.add(`${check.name}: ${check.detail}`);
      if (check.status === 'error') failures.add(`${check.name}: ${check.detail} (error)`);
    }
    if (run.error) failures.add(`run: ${run.error}`);
  }
  return {
    id,
    category,
    runs: runs.length,
    passes,
    fails,
    errors,
    passRate: passes + fails === 0 ? null : passes / (passes + fails),
    failures: [...failures],
  };
}

/**
 * Run every case `repeat` times. A model answers differently each time, so one run proves little:
 * the pass rate over several runs is what is compared.
 */
export async function runSuite(
  cases: readonly EvalCase[],
  options: RunOptions & { model: string; repeat?: number; onCase?: (summary: CaseSummary) => void },
): Promise<SuiteResult> {
  const repeat = options.repeat ?? 1;
  const summaries: CaseSummary[] = [];
  for (const item of cases) {
    const runs: CaseResult[] = [];
    for (let n = 0; n < repeat; n++) runs.push(await runCase(item, options));
    const summary = summarize(item.id, item.category, runs);
    summaries.push(summary);
    options.onCase?.(summary);
  }
  return {
    schemaVersion: 1,
    createdAt: new Date().toISOString(),
    model: options.model,
    promptHash: hashPrompt(options.systemPrompt ?? DEFAULT_SYSTEM_PROMPT),
    repeat,
    cases: summaries,
  };
}
