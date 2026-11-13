import { z } from 'zod';

import type { CaseSummary, SuiteResult } from './runner.js';

/** The shape of a saved result file, checked when it is read back. */
const SummarySchema = z.object({
  id: z.string(),
  category: z.enum(['task', 'injection', 'report']),
  runs: z.number().int().nonnegative(),
  passes: z.number().int().nonnegative(),
  fails: z.number().int().nonnegative(),
  errors: z.number().int().nonnegative(),
  passRate: z.number().min(0).max(1).nullable(),
  failures: z.array(z.string()),
});

const SuiteSchema = z.object({
  schemaVersion: z.literal(1),
  createdAt: z.string(),
  model: z.string(),
  promptHash: z.string(),
  repeat: z.number().int().positive(),
  cases: z.array(SummarySchema),
});

export function parseSuite(text: string): SuiteResult {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error('the result file is not valid JSON');
  }
  const parsed = SuiteSchema.safeParse(json);
  if (!parsed.success) throw new Error('the result file is not a result of this version');
  return parsed.data;
}

export interface Change {
  id: string;
  category: CaseSummary['category'];
  before: number;
  after: number;
}

export interface Comparison {
  regressions: Change[];
  improvements: Change[];
  unchanged: string[];
  /** In the baseline but not in the new run, so nothing can be said about it. */
  missing: string[];
  /** In the new run only. */
  added: string[];
  /** One side had only errors, so there is no pass rate to compare. */
  notComparable: string[];
  promptChanged: boolean;
  modelChanged: boolean;
}

/**
 * Compare a run with a baseline, case by case. A drop in pass rate larger than `tolerance` is a
 * regression. With repeated runs a model varies, so allow some tolerance; with a fixed script use 0.
 */
export function compare(baseline: SuiteResult, current: SuiteResult, tolerance = 0): Comparison {
  const before = new Map(baseline.cases.map((c) => [c.id, c]));
  const result: Comparison = {
    regressions: [],
    improvements: [],
    unchanged: [],
    missing: [],
    added: [],
    notComparable: [],
    promptChanged: baseline.promptHash !== current.promptHash,
    modelChanged: baseline.model !== current.model,
  };
  for (const now of current.cases) {
    const was = before.get(now.id);
    before.delete(now.id);
    if (!was) {
      result.added.push(now.id);
      continue;
    }
    if (was.passRate === null || now.passRate === null) {
      result.notComparable.push(now.id);
      continue;
    }
    const change: Change = {
      id: now.id,
      category: now.category,
      before: was.passRate,
      after: now.passRate,
    };
    if (now.passRate < was.passRate - tolerance) result.regressions.push(change);
    else if (now.passRate > was.passRate + tolerance) result.improvements.push(change);
    else result.unchanged.push(now.id);
  }
  result.missing = [...before.keys()];
  return result;
}
