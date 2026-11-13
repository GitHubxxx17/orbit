# ADR 0006: Replay, fork and rollback are derived from the event log

- Status: accepted
- Date: 2026-11-13

## Context

Orbit's first selling point is that a run is an append-only event log, so it can be replayed,
branched and undone. Until now none of that was usable: the log did not keep the text a write
replaced (only a diff preview), and nothing could branch a conversation.

## Decision

**Replay** is read-only and lives in the web app. It folds a prefix of the stored events with the
same function the live view uses, so a replay cannot differ from what happened. A burst of streamed
text is one stop; every other event is a stop.

**Rollback** needs the previous text, so two events are added (both increments; old logs stay valid):

- `file.changed { callId, path, before | null, after }`, appended by the runtime when a tool
  reports a real change through `ToolContext.recordChange`, before `tool.result`. Both versions are
  stored in the log (a write is capped at 200,000 characters), which makes the log larger and puts
  file text in it, like tool results already do.
- `file.rolledback { callId, path }`, appended when the user undoes it. It is the only event allowed
  after a run's terminal event, because a rollback happens long after the run ended. The invariant
  checker accepts it there and flags a rollback without a change, or a second rollback.

Rollback on disk (`rollbackWrite` in `@orbit/tools`) goes through the same sandbox as writing. It
puts `before` back, or deletes the file if it did not exist, and **refuses** if the file no longer
equals `after`. Undoing over someone's later edit would destroy work, so a conflict is an error the
user resolves. Consequence: changes to one file are undone newest first. The server refuses a
rollback while any run is going and handles one rollback at a time.

**Fork** copies the first N runs of a session into new runs of a new session, by appending copies
of their events. The original is untouched and event ids and run ids are new. A fork is at a run
boundary, not in the middle of a run. `file.changed` and `file.rolledback` are not copied: the
workspace is not forked, so the copy must not offer to undo writes it did not make.

## Consequences

- Forking does not restore files. If the original run wrote files, the workspace keeps them and the
  forked conversation starts from the files as they are now. This is stated in the UI docs, and
  rolling back first is the way to return to the earlier file state.
- Copied events get new timestamps, so a fork's replay shows when it was forked, not the original timing.
- Rollback restores text files only (the write tool refuses binary files). An empty directory
  created by a write is left behind after the file is removed.
- A stored change from before this ADR has no `file.changed`, so it cannot be rolled back.
- Forking in the middle of a run, and branching the file state, are not done.
