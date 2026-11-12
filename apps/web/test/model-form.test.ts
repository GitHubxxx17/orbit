import { describe, expect, it } from 'vitest';

import { modelFormInput, modelFormProblem } from '@/lib/model-form';

const values = { baseUrl: ' https://a.example ', model: ' m ', apiKey: '' };

describe('modelFormProblem', () => {
  it('asks for every field', () => {
    expect(modelFormProblem({ ...values, baseUrl: ' ' }, true)).toMatch(/接口地址/);
    expect(modelFormProblem({ ...values, model: '' }, true)).toMatch(/模型/);
  });
  it('needs a key only when none is in use', () => {
    expect(modelFormProblem(values, false)).toMatch(/API Key/);
    expect(modelFormProblem(values, true)).toBeNull();
    expect(modelFormProblem({ ...values, apiKey: 'k' }, false)).toBeNull();
  });
});

describe('modelFormInput', () => {
  it('trims, and leaves an empty key out', () => {
    expect(modelFormInput(values)).toEqual({ baseUrl: 'https://a.example', model: 'm' });
    expect(modelFormInput({ ...values, apiKey: ' k ' })).toEqual({
      baseUrl: 'https://a.example',
      model: 'm',
      apiKey: 'k',
    });
  });
});
