import { describe, expect, it } from 'vitest';

import { modelFormInput, modelFormProblem, parseWindow } from '@/lib/model-form';

const values = {
  label: '',
  baseUrl: ' https://a.example ',
  model: ' m ',
  apiKey: '',
  contextWindow: '',
};

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
    expect(modelFormInput(values)).toEqual({
      baseUrl: 'https://a.example',
      model: 'm',
      contextWindow: null,
    });
    expect(modelFormInput({ ...values, apiKey: ' k ' })).toEqual({
      baseUrl: 'https://a.example',
      model: 'm',
      apiKey: 'k',
      contextWindow: null,
    });
  });
  it('sends a label only when one was typed', () => {
    expect(modelFormInput({ ...values, label: ' 工作用 ' })).toMatchObject({ label: '工作用' });
  });
});

describe('parseWindow', () => {
  it('reads plain numbers and the k and m suffixes providers use', () => {
    expect(parseWindow('128000')).toBe(128_000);
    expect(parseWindow(' 128k ')).toBe(128_000);
    expect(parseWindow('1M')).toBe(1_000_000);
    expect(parseWindow('1,000,000')).toBe(1_000_000);
  });

  it('treats empty as "not known" and rejects nonsense or out-of-range sizes', () => {
    expect(parseWindow('')).toBeNull();
    expect(parseWindow('   ')).toBeNull();
    for (const bad of ['abc', '12.5k', '-5', '500', '50m', '0']) {
      expect(parseWindow(bad)).toBeUndefined();
    }
  });
});

describe('the window in the model form', () => {
  it('blocks an invalid window and sends null for an empty one', () => {
    expect(modelFormProblem({ ...values, contextWindow: 'lots' }, true)).toMatch(/上下文窗口/);
    expect(modelFormProblem({ ...values, contextWindow: '128k' }, true)).toBeNull();
    expect(modelFormInput({ ...values, contextWindow: '128k' })).toMatchObject({
      contextWindow: 128_000,
    });
  });
});
