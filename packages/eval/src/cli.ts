import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import {
  createOpenAICompatibleClient,
  DEFAULT_SYSTEM_PROMPT,
  loadLlmConfig,
  type LlmConfig,
} from '@orbit/core';
import { z } from 'zod';

import { loadCases } from './case.js';
import { compare, parseSuite } from './compare.js';
import { formatComparison, formatSuite } from './format.js';
import { createLlmJudge } from './judge.js';
import { runSuite } from './runner.js';
import { selfCheck } from './self-check.js';

const USAGE = `Usage: pnpm eval --model <live|scripted> [options]

  --model scripted     check the harness itself with scripted models (no network, no key)
  --model live         run the cases against the configured model
  --category <name>    only task, injection or report cases
  --case <id>          only one case
  --repeat <n>         runs per case (default 1; use 3 or more for a real model)
  --out <file>         save the result as JSON
  --baseline <file>    compare with an earlier result; exits 1 on a regression
  --tolerance <x>      allowed drop in pass rate before it counts as a regression (default 0)
  --prompt <file>      system prompt to test instead of Orbit's own
  --judge              use the model as a judge for the judge checks
  --judge-model <name> use another model name on the same endpoint as the judge

The live model comes from ORBIT_LLM_BASE_URL, ORBIT_LLM_API_KEY and ORBIT_LLM_MODEL (.env), or
from the model saved on the settings page (~/.orbit/settings.json).`;

/** The model saved on the settings page, if any. The key is read here and never printed. */
function savedModel(): LlmConfig | undefined {
  const dir = process.env['ORBIT_DATA_DIR'] ?? path.join(os.homedir(), '.orbit');
  try {
    const raw: unknown = JSON.parse(readFileSync(path.join(dir, 'settings.json'), 'utf8'));
    const parsed = z
      .object({
        model: z.object({ baseUrl: z.string(), apiKey: z.string(), model: z.string() }),
      })
      .safeParse(raw);
    return parsed.success ? parsed.data.model : undefined;
  } catch {
    return undefined;
  }
}

function liveConfig(): LlmConfig {
  try {
    return loadLlmConfig(process.env);
  } catch {
    const saved = savedModel();
    if (saved) return saved;
    throw new Error(
      'no model configured: set ORBIT_LLM_* in .env or save one on the settings page',
    );
  }
}

async function main(): Promise<number> {
  // pnpm may forward a lone "--"; parseArgs would treat everything after it as positional.
  const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--'));
  const { values } = parseArgs({
    args,
    options: {
      model: { type: 'string' },
      category: { type: 'string' },
      case: { type: 'string' },
      repeat: { type: 'string', default: '1' },
      out: { type: 'string' },
      baseline: { type: 'string' },
      tolerance: { type: 'string', default: '0' },
      prompt: { type: 'string' },
      judge: { type: 'boolean', default: false },
      'judge-model': { type: 'string' },
      help: { type: 'boolean', default: false },
    },
    allowPositionals: false,
  });
  if (values.help || (values.model !== 'live' && values.model !== 'scripted')) {
    console.log(USAGE);
    return values.help ? 0 : 2;
  }

  const repeat = Number(values.repeat);
  const tolerance = Number(values.tolerance);
  if (!Number.isInteger(repeat) || repeat < 1 || repeat > 20) throw new Error('--repeat: 1 to 20');
  if (!(tolerance >= 0 && tolerance <= 1)) throw new Error('--tolerance: 0 to 1');

  let cases = loadCases(fileURLToPath(new URL('../cases', import.meta.url)));
  if (values.category) cases = cases.filter((c) => c.category === values.category);
  if (values.case) cases = cases.filter((c) => c.id === values.case);
  if (cases.length === 0) throw new Error('no case matches');

  if (values.model === 'scripted') {
    const problems = await selfCheck(cases);
    for (const p of problems) console.log(`PROBLEM ${p.id}: ${p.problem}`);
    console.log(
      problems.length === 0
        ? `${cases.length} cases: every good script passes and every bad script fails`
        : `${problems.length} problem(s)`,
    );
    return problems.length === 0 ? 0 : 1;
  }

  const config = liveConfig();
  const systemPrompt = values.prompt ? readFileSync(values.prompt, 'utf8') : DEFAULT_SYSTEM_PROMPT;
  const llm = createOpenAICompatibleClient(config);
  const judge = values.judge
    ? createLlmJudge(
        values['judge-model']
          ? createOpenAICompatibleClient({ ...config, model: values['judge-model'] })
          : llm,
      )
    : undefined;

  console.log(
    `Running ${cases.length} case(s) x ${repeat} against ${config.model}. The case files are sent ` +
      `to ${new URL(config.baseUrl).host}.${judge ? ' A judge model grades the open questions.' : ''}`,
  );
  const suite = await runSuite(cases, {
    llm,
    model: config.model,
    systemPrompt,
    repeat,
    judge,
    onCase: (s) => console.log(`  ${s.id}: ${s.passes}/${s.runs} passed`),
  });
  console.log(`\n${formatSuite(suite)}`);

  if (values.out) {
    mkdirSync(path.dirname(path.resolve(values.out)), { recursive: true });
    writeFileSync(values.out, JSON.stringify(suite, null, 2));
    console.log(`\nsaved to ${values.out}`);
  }
  if (values.baseline) {
    const baseline = parseSuite(readFileSync(values.baseline, 'utf8'));
    const result = compare(baseline, suite, tolerance);
    console.log(`\nvs ${values.baseline}\n${formatComparison(result)}`);
    return result.regressions.length === 0 ? 0 : 1;
  }
  return 0;
}

main().then(
  (code) => process.exit(code),
  (error: unknown) => {
    // The message names the problem; it never contains the key.
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  },
);
