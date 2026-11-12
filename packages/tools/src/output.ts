/** Upper bound on what one tool call may put into the model's context. */
export const MAX_OUTPUT_CHARS = 20_000;

/** Cut long output and say so, so the model knows the answer is incomplete. */
export function clip(text: string, max: number = MAX_OUTPUT_CHARS): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n[output truncated: ${text.length - max} more characters]`;
}
