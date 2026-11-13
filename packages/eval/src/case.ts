import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

/**
 * An evaluation case: a small workspace, a request, and checks on what the agent did. Cases are
 * data, so they can be reviewed and extended without touching code.
 */

/** A relative path inside the case workspace. Nothing that could leave it. */
const CasePath = z
  .string()
  .min(1)
  .max(200)
  .refine(
    (value) =>
      !value.includes('\0') &&
      !path.isAbsolute(value) &&
      !value.split(/[\\/]/).includes('..') &&
      !value.startsWith('~'),
    'must be a relative path inside the workspace',
  );

export const Check = z.discriminatedUnion('type', [
  /** The run ended normally. */
  z.object({ type: z.literal('run-completed') }),
  z.object({
    type: z.literal('tool-called'),
    tool: z.string().min(1),
    argIncludes: z.string().min(1).optional(),
  }),
  z.object({
    type: z.literal('tool-not-called'),
    tool: z.string().min(1),
    argIncludes: z.string().min(1).optional(),
  }),
  z.object({ type: z.literal('answer-includes'), text: z.string().min(1) }),
  z.object({ type: z.literal('answer-excludes'), text: z.string().min(1) }),
  z.object({ type: z.literal('file-unchanged'), path: CasePath }),
  z.object({ type: z.literal('file-absent'), path: CasePath }),
  z.object({ type: z.literal('file-includes'), path: CasePath, text: z.string().min(1) }),
  /** The text appears nowhere the agent could have put it: its answer, write arguments, files. */
  z.object({ type: z.literal('no-leak'), text: z.string().min(1) }),
  /** The agent made a report. */
  z.object({ type: z.literal('report-made') }),
  /** Every claim of the report cites real, successful calls (the rule from ADR 0007). */
  z.object({ type: z.literal('report-all-supported') }),
  /** No claim of the newest report contains the text. Passes when there is no report. */
  z.object({ type: z.literal('report-excludes'), text: z.string().min(1) }),
  /** A judge model decides an open question about the answer. Needs a judge. */
  z.object({ type: z.literal('judge'), criterion: z.string().min(1) }),
  /** A judge model checks that each claim is supported by the output it cites. Needs a judge. */
  z.object({ type: z.literal('claims-semantic') }),
]);
export type Check = z.infer<typeof Check>;

/** One scripted model turn: some words, and optionally one tool call. */
export const Step = z.object({
  say: z.string().optional(),
  call: z.object({ name: z.string().min(1), args: z.record(z.string(), z.unknown()) }).optional(),
});
export type Step = z.infer<typeof Step>;

export const EvalCase = z.object({
  id: z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/, 'lowercase letters, digits and -'),
  category: z.enum(['task', 'injection', 'report']),
  description: z.string().min(1),
  /** The workspace the agent sees: relative path -> file content. */
  files: z.record(CasePath, z.string()),
  prompt: z.string().min(1),
  checks: z.array(Check).min(1),
  /**
   * Scripts for the harness's own check, not an evaluation of any model: `pass` is a behaviour
   * the checks must accept, `fail` one they must reject. Tool call ids are s1, s2, ... in order.
   */
  selfTest: z.object({ pass: z.array(Step).min(1), fail: z.array(Step).min(1) }).optional(),
});
export type EvalCase = z.infer<typeof EvalCase>;

export class CaseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CaseError';
  }
}

/** Parse one case file. The error names the file and the field, never dumps the content. */
export function parseCase(text: string, source: string): EvalCase {
  let json: unknown;
  try {
    json = JSON.parse(text);
  } catch {
    throw new CaseError(`${source}: not valid JSON`);
  }
  const parsed = EvalCase.safeParse(json);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new CaseError(
      `${source}: ${issue?.path.join('.') ?? ''}: ${issue?.message ?? 'invalid'}`,
    );
  }
  return parsed.data;
}

/** Every `*.json` case in a folder, sorted by id. Ids must be unique. */
export function loadCases(dir: string): EvalCase[] {
  const cases = readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .sort()
    .map((name) => parseCase(readFileSync(path.join(dir, name), 'utf8'), name));
  const seen = new Set<string>();
  for (const item of cases) {
    if (seen.has(item.id)) throw new CaseError(`duplicate case id: ${item.id}`);
    seen.add(item.id);
  }
  return cases.sort((a, b) => a.id.localeCompare(b.id));
}
