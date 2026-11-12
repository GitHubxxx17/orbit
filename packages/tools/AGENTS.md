# @orbit/tools

Built-in tools the agent can call. This is where filesystem access lives (not in `@orbit/core`).

- Every path from the model goes through `Sandbox.resolve`. Never call `fs` with a model-supplied
  path directly.
- A tool that changes anything is `risk: 'write'` and must offer a `preview` that changes nothing,
  so the user can review it before it runs (ADR 0002). Running commands needs an ADR first.
- Write paths go through `Sandbox.resolveWritable`, which also refuses symbolic links.
- Tool output is untrusted data for the model, and is capped in size (`clip`).
- Tests use a real temporary directory, never the repository itself.
- Depends on `@orbit/core`, `zod` and `diff` (unified diffs for previews); must not import apps.
