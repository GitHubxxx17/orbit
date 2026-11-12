# @orbit/tools

Built-in tools the agent can call. This is where filesystem access lives (not in `@orbit/core`).

- Every path from the model goes through `Sandbox.resolve`. Never call `fs` with a model-supplied
  path directly.
- Tools here are `risk: 'read'` only. A tool that writes or runs commands needs the policy engine
  and an ADR first.
- Tool output is untrusted data for the model, and is capped in size (`clip`).
- Tests use a real temporary directory, never the repository itself.
- Depends on `@orbit/core` and `zod` only; must not import apps.
