import type { Comparison } from './compare.js';
import type { CaseSummary, SuiteResult } from './runner.js';

const percent = (rate: number | null) => (rate === null ? 'n/a' : `${Math.round(rate * 100)}%`);

/** The per-category pass rate, so injection robustness is visible apart from task success. */
export function categoryRates(cases: readonly CaseSummary[]): Record<string, number | null> {
  const rates: Record<string, number | null> = {};
  for (const category of new Set(cases.map((c) => c.category))) {
    const scored = cases.filter((c) => c.category === category && c.passRate !== null);
    rates[category] =
      scored.length === 0
        ? null
        : scored.reduce((sum, c) => sum + (c.passRate ?? 0), 0) / scored.length;
  }
  return rates;
}

export function formatSuite(suite: SuiteResult): string {
  const lines = [
    `model: ${suite.model}   prompt: ${suite.promptHash}   runs per case: ${suite.repeat}`,
    '',
  ];
  for (const item of suite.cases) {
    const marker = item.fails + item.errors === 0 ? 'PASS' : item.passes === 0 ? 'FAIL' : 'MIXED';
    const errors = item.errors > 0 ? `  (${item.errors} errored)` : '';
    lines.push(
      `${marker.padEnd(5)} ${item.id.padEnd(34)} ${item.category.padEnd(10)} ${percent(item.passRate).padStart(4)}${errors}`,
    );
    for (const failure of item.failures) lines.push(`        - ${failure}`);
  }
  lines.push('');
  const rates = categoryRates(suite.cases);
  lines.push(
    `pass rate by category: ${Object.entries(rates)
      .map(([name, rate]) => `${name} ${percent(rate)}`)
      .join(', ')}`,
  );
  return lines.join('\n');
}

export function formatComparison(result: Comparison): string {
  const lines: string[] = [];
  if (result.modelChanged) lines.push('note: the model differs from the baseline');
  if (result.promptChanged) lines.push('note: the system prompt differs from the baseline');
  const list = (title: string, items: string[]) => {
    if (items.length > 0) lines.push(`${title}: ${items.join(', ')}`);
  };
  for (const c of result.regressions) {
    lines.push(`REGRESSION ${c.id} (${c.category}): ${percent(c.before)} -> ${percent(c.after)}`);
  }
  for (const c of result.improvements) {
    lines.push(`improved   ${c.id} (${c.category}): ${percent(c.before)} -> ${percent(c.after)}`);
  }
  list('unchanged', result.unchanged);
  list('not in this run', result.missing);
  list('new', result.added);
  list('not comparable (all runs errored)', result.notComparable);
  lines.push(
    result.regressions.length === 0
      ? 'no regressions'
      : `${result.regressions.length} regression(s)`,
  );
  return lines.join('\n');
}
