import { describe, expect, it } from 'vitest';

import { agentFormInput, agentFormProblem, EMPTY_AGENT } from '@/lib/agent-form';

const valid = { ...EMPTY_AGENT, name: ' Reviewer ' };

describe('agentFormProblem', () => {
  it('needs a name', () => {
    expect(agentFormProblem(EMPTY_AGENT)).toMatch(/名称/);
    expect(agentFormProblem({ ...EMPTY_AGENT, name: '  ' })).toMatch(/名称/);
    expect(agentFormProblem(valid)).toBeNull();
  });

  it('does not accept "pick tools" with none picked, but accepts all tools or some', () => {
    expect(agentFormProblem({ ...valid, tools: [] })).toMatch(/工具/);
    expect(agentFormProblem({ ...valid, tools: ['read_file'] })).toBeNull();
    expect(agentFormProblem({ ...valid, tools: null })).toBeNull();
  });
});

describe('agentFormInput', () => {
  it('trims the text and keeps null for "all tools" and "follow the input box"', () => {
    expect(agentFormInput({ ...valid, instructions: ' be brief ' })).toEqual({
      name: 'Reviewer',
      description: '',
      instructions: 'be brief',
      modelId: null,
      tools: null,
    });
  });
});
