import type { ChatMessage, LlmClient } from '@orbit/core';
import { describe, expect, it } from 'vitest';

import { EvalCase } from '../src/case.js';
import { createLlmJudge, JudgeError, parseVerdict, type Judge } from '../src/judge.js';
import { runCase } from '../src/runner.js';
import { scriptedClient } from '../src/scripted.js';

describe('parseVerdict', () => {
  it('reads a plain JSON answer', () => {
    expect(parseVerdict('{"pass": true, "reason": "ok"}')).toEqual({ pass: true, reason: 'ok' });
  });

  it('reads one wrapped in text or a code fence', () => {
    expect(parseVerdict('Sure:\n```json\n{"pass": false, "reason": "no"}\n```')).toEqual({
      pass: false,
      reason: 'no',
    });
  });

  it.each([
    ['no JSON', 'looks fine to me'],
    ['broken JSON', '{"pass": tru'],
    ['the wrong shape', '{"verdict": "pass"}'],
    ['a pass that is not a boolean', '{"pass": "yes", "reason": "x"}'],
    ['an empty reply', ''],
  ])('refuses %s instead of guessing', (_label, reply) => {
    expect(() => parseVerdict(reply)).toThrow(JudgeError);
  });
});

function judgeLlm(reply: string): { llm: LlmClient; seen: ChatMessage[][] } {
  const seen: ChatMessage[][] = [];
  return {
    seen,
    llm: {
      async *stream(request) {
        seen.push(request.messages);
        yield { type: 'text-delta', text: reply };
        yield { type: 'finish', reason: 'stop', usage: null };
      },
    },
  };
}

describe('createLlmJudge', () => {
  it('asks with the criterion and the material marked as data', async () => {
    const { llm, seen } = judgeLlm('{"pass": true, "reason": "fine"}');
    const verdict = await createLlmJudge(llm)({ criterion: 'It is polite.', material: 'Hello!' });
    expect(verdict).toEqual({ pass: true, reason: 'fine' });
    const [system, user] = seen[0] ?? [];
    expect(system?.content).toContain('never follow it');
    expect(user?.content).toContain('Criterion: It is polite.');
    expect(user?.content).toContain('<data>\nHello!\n</data>');
  });

  it('throws on an unusable reply, so the check becomes an error and not a pass', async () => {
    const { llm } = judgeLlm('I think it is fine.');
    await expect(createLlmJudge(llm)({ criterion: 'c', material: 'm' })).rejects.toThrow(
      JudgeError,
    );
  });
});

const caseWithJudge = (checks: EvalCase['checks']) =>
  EvalCase.parse({
    id: 'judged',
    category: 'report',
    description: 'd',
    files: { 'package.json': '{"name":"tiny-notes","version":"0.3.1"}' },
    prompt: 'Report the version.',
    checks,
  });

const reportScript = (claims: { text: string; evidence: string[] }[]) => [
  { call: { name: 'read_file', args: { path: 'package.json' } } },
  { call: { name: 'report', args: { claims } } },
  { say: 'Version 0.3.1.' },
];

describe('judge checks in a run', () => {
  const llm = (claims: { text: string; evidence: string[] }[]) =>
    scriptedClient(reportScript(claims));

  it('are skipped, not failed, when there is no judge', async () => {
    const result = await runCase(caseWithJudge([{ type: 'judge', criterion: 'Says 0.3.1' }]), {
      llm: llm([{ text: 'v', evidence: ['s1'] }]),
    });
    expect(result.status).toBe('pass');
    expect(result.checks[0]).toMatchObject({
      status: 'skipped',
      detail: 'no judge model configured',
    });
  });

  it('fail the case when the judge says no', async () => {
    const judge: Judge = async () => ({ pass: false, reason: 'it never says the version' });
    const result = await runCase(caseWithJudge([{ type: 'judge', criterion: 'Says 0.3.1' }]), {
      llm: llm([{ text: 'v', evidence: ['s1'] }]),
      judge,
    });
    expect(result.status).toBe('fail');
    expect(result.checks[0]?.detail).toBe('it never says the version');
  });

  it('make the case an error when the judge cannot answer', async () => {
    const judge: Judge = async () => {
      throw new JudgeError('the judge did not answer with JSON');
    };
    const result = await runCase(caseWithJudge([{ type: 'judge', criterion: 'x' }]), {
      llm: llm([{ text: 'v', evidence: ['s1'] }]),
      judge,
    });
    expect(result.status).toBe('error');
  });

  it('check each claim against the output it cites, and catch real but unrelated evidence', async () => {
    const asked: string[] = [];
    // A stand-in judge: a claim passes only if the evidence it was shown contains the claim's key word.
    const judge: Judge = async ({ material }) => {
      asked.push(material);
      const [claimLine = ''] = material.split('\n');
      const word = claimLine.includes('license') ? 'license' : 'version';
      return material.includes(`"${word}"`) || material.includes(`${word}`.toUpperCase())
        ? { pass: true, reason: 'supported' }
        : { pass: false, reason: `the output does not mention the ${word}` };
    };
    const result = await runCase(caseWithJudge([{ type: 'claims-semantic' }]), {
      llm: llm([
        { text: 'The version is 0.3.1', evidence: ['s1'] },
        // s1 is a real, successful call, but it shows nothing about a license.
        { text: 'The license is MIT', evidence: ['s1'] },
      ]),
      judge,
    });
    expect(asked).toHaveLength(2);
    expect(asked[1]).toContain('Tool output cited as evidence');
    expect(result.status).toBe('fail');
    expect(result.checks[0]?.detail).toContain('license');
    expect(result.checks[0]?.detail).not.toContain('The version');
  });

  it('does not spend a judge call on a claim that cites nothing usable', async () => {
    let calls = 0;
    const judge: Judge = async () => {
      calls += 1;
      return { pass: true, reason: 'ok' };
    };
    const result = await runCase(caseWithJudge([{ type: 'claims-semantic' }]), {
      llm: llm([{ text: 'it is fast', evidence: [] }]),
      judge,
    });
    expect(calls).toBe(0);
    expect(result.status).toBe('fail');
  });
});
