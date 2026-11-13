export interface AgentFormValues {
  name: string;
  description: string;
  instructions: string;
  /** A saved model, or null to follow the choice in the input box. */
  modelId: string | null;
  /** The tools this agent may call, or null for all of them. */
  tools: string[] | null;
}

export const EMPTY_AGENT: AgentFormValues = {
  name: '',
  description: '',
  instructions: '',
  modelId: null,
  tools: null,
};

/** Why the form cannot be sent yet, or null when it can. */
export function agentFormProblem(values: AgentFormValues): string | null {
  if (values.name.trim() === '') return '请填写名称';
  // Choosing "pick tools" and then none leaves an agent that can only report, which is never meant.
  if (values.tools !== null && values.tools.length === 0)
    return '自选工具时至少选一个，或改成全部工具';
  return null;
}

/** The request body. Empty text is sent as empty, and "all tools" as null. */
export function agentFormInput(values: AgentFormValues) {
  return {
    name: values.name.trim(),
    description: values.description.trim(),
    instructions: values.instructions.trim(),
    modelId: values.modelId,
    tools: values.tools,
  };
}
