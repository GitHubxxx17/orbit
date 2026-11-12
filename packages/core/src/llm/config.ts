import { z } from 'zod';

const EnvSchema = z.object({
  ORBIT_LLM_BASE_URL: z.url(),
  ORBIT_LLM_API_KEY: z.string().min(1),
  ORBIT_LLM_MODEL: z.string().min(1),
});

export interface LlmConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
}

/**
 * Read model settings from environment variables.
 * Error messages name the offending variables but never include their values.
 */
export function loadLlmConfig(env: Record<string, string | undefined>): LlmConfig {
  const result = EnvSchema.safeParse(env);
  if (!result.success) {
    const names = [...new Set(result.error.issues.map((issue) => String(issue.path[0])))];
    throw new Error(`Missing or invalid environment variables: ${names.join(', ')}`);
  }
  const { ORBIT_LLM_BASE_URL, ORBIT_LLM_API_KEY, ORBIT_LLM_MODEL } = result.data;
  return { baseUrl: ORBIT_LLM_BASE_URL, apiKey: ORBIT_LLM_API_KEY, model: ORBIT_LLM_MODEL };
}
