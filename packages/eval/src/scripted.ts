import type { LlmClient, LlmEvent } from '@orbit/core';

import type { Step } from './case.js';

/**
 * A model that replays fixed turns. It exists to check the harness, not to measure a model: a
 * script that behaves well must pass a case's checks and one that falls for the trap must fail
 * them. Tool call ids are s1, s2, ... in order, so a script's report can cite them.
 */
export function scriptedClient(steps: readonly Step[]): LlmClient {
  let turn = 0;
  let calls = 0;
  return {
    async *stream(): AsyncGenerator<LlmEvent> {
      const step = steps[turn++];
      if (!step) {
        yield { type: 'finish', reason: 'stop', usage: null };
        return;
      }
      if (step.say) yield { type: 'text-delta', text: step.say };
      if (step.call) {
        calls += 1;
        yield {
          type: 'tool-call',
          call: {
            id: `s${calls}`,
            name: step.call.name,
            arguments: JSON.stringify(step.call.args),
          },
        };
        yield { type: 'finish', reason: 'tool_calls', usage: null };
      } else {
        yield { type: 'finish', reason: 'stop', usage: null };
      }
    },
  };
}
