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

- A tool that changes a file must report it with `context.recordChange({path, before, after})` so
  the change is logged and can be rolled back (ADR 0006). `rollbackWrite` refuses when the file no
  longer equals `after`.

- Every model call sends the whole conversation again, so prefer tools that do more per call
  (`read_files`, `list_dir` with `depth`) over many small ones (ADR 0016). A batch tool must go
  through the same code and sandbox as its one-at-a-time version, report a file it cannot read in
  its place instead of failing the rest, and cap the total output. Mark a tool `idempotent` only if
  it merely reads the workspace.
