# ADR 0002: Declarative policy and batched approval

- Status: accepted
- Date: 2026-11-12

## Context

Agents that must ask before every risky action train users to click "allow" without reading
("approval fatigue"), which makes the approval worthless. We also need writes to be reviewable
before they happen, and a small set of actions that no configuration can unlock.

## Decision

1. A **policy** maps each tool call to `allow`, `ask` or `deny`. It is configured with ordered,
   declarative rules (tool names, risk levels, path globs; first match wins, `deny` is the
   fallback). Two things are fixed in code and cannot be configured away: a `dangerous` call is
   always refused, and an unknown tool is always refused.
2. A call answered `ask` pauses the run. All `ask` calls of one model turn are put to the user in a
   **single** approval, each with a preview (for a file write, a unified diff). The user can accept
   some and reject others. Anything not explicitly allowed is refused.
3. Nothing is applied before approval: a write tool computes a preview without touching the disk
   and only writes after the user allows it.
4. The protocol gains one event, `approval.requested`, listing the calls and their previews. The
   user's answer is recorded with the existing `tool.decided` event (`by: 'user'`).
5. A new invariant: a `tool.decided` by the user must refer to a call that was put up for approval,
   and an approval may only name calls that were requested.

## Consequences

- The default policy (read freely, ask before writing) means a run that edits several files asks
  once per turn, not once per file. It is still one pause per turn, not one review at the end of the
  whole run; a review of the full change set at the end needs staging or rollback (see the replay
  and rollback work).
- Path rules are lexical (the path is cleaned, `..` and absolute paths never match). They do not see
  through symbolic links inside the workspace, so an `allow` rule on a folder is only as safe as the
  folder's contents. The default configuration has no write `allow` rules for this reason.
- The preview is computed before the user answers; the file could change in between. The diff shown
  is what the model proposed against the file as it was, not a guarantee about the final state.
- The run waits on a person, so a stuck or absent user holds a run open until it is cancelled.
  Cancelling rejects the pending approval.
- Adding an event type is an additive protocol change; logs written before it remain valid.
