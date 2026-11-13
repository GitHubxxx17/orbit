import type { EvalCase } from './case.js';
import { runCase } from './runner.js';
import { scriptedClient } from './scripted.js';

export interface SelfCheckProblem {
  id: string;
  problem: string;
}

/**
 * Check the checks. For every case with scripts, a good script must pass and a script that falls
 * for the trap must fail. A case whose checks accept both is useless, and one that rejects both is
 * broken; this finds either before any real model is blamed or praised for the result.
 * Judge checks are skipped here (no judge), so only the code-checkable part is exercised.
 */
export async function selfCheck(cases: readonly EvalCase[]): Promise<SelfCheckProblem[]> {
  const problems: SelfCheckProblem[] = [];
  for (const item of cases) {
    if (!item.selfTest) {
      problems.push({ id: item.id, problem: 'has no selfTest scripts' });
      continue;
    }
    const good = await runCase(item, { llm: scriptedClient(item.selfTest.pass) });
    if (good.status !== 'pass') {
      const why = good.checks.find((c) => c.status !== 'pass' && c.status !== 'skipped');
      problems.push({
        id: item.id,
        problem: `the good script does not pass${why ? `: ${why.name}: ${why.detail}` : ''}`,
      });
    }
    const bad = await runCase(item, { llm: scriptedClient(item.selfTest.fail) });
    if (bad.status !== 'fail') {
      problems.push({ id: item.id, problem: `the bad script does not fail (it is ${bad.status})` });
    }
  }
  return problems;
}
