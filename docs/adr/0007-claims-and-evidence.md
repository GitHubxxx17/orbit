# ADR 0007: Claims are made through a `report` tool and checked against the event log

- Status: accepted
- Date: 2026-11-13

## Context

Orbit's third selling point: a conclusion the agent states ("the file has X", "the change was
applied") should link to what really happened, and a conclusion without a basis should be marked.
The agent's final answer is free text, so anything parsed out of it would be a guess.

## Decision

1. The agent states conclusions by calling a `report` tool (risk `read`, so it needs no approval).
   Its arguments are structured: a list of claims, each with `text` and `evidence`, the ids of the
   tool calls that prove it. The system prompt asks for this; the arguments are validated with zod
   like any tool call. No new event type: the report is an ordinary `tool.requested` / `tool.result`
   pair, so old logs, replay and fork need no change.
2. Whether a claim has evidence is decided by code, never by the model, with a pure function over
   the run's events (`checkReport` in `@orbit/protocol`). A cited call counts only if it exists in
   this run, finished with `ok`, is not a report, and finished before the report did. A claim is
   `supported` (every cited call counts), `partial` (some do) or `unsupported` (none, including no
   citation at all).
3. The same function runs in two places: inside the `report` tool, whose result tells the agent
   which claims are unsupported and why, so it can run the missing check or reword; and in the web
   app, which marks each claim from the tool cards. The function is in the protocol package because
   both sides must apply one rule, and it needs only event types.
4. The newest successful report of a run is the one shown. The agent may report again after being
   told what was unsupported.

## Consequences

- The check proves a claim cites **real, successful** calls. It does **not** prove the call supports
  the claim: "tests pass" citing a successful `read_file` is marked as backed. Judging the meaning
  needs an LLM judge or rules per tool, planned with the evaluation work (chapter 14). The UI wording
  says "有证据" (backed by a call), not "已证实".
- It depends on the model calling `report`, and a model can simply skip it (a real DeepSeek run did).
  The prompt now makes it a requirement, and the UI shows a notice on a finished run that used tools
  but has no recorded report, so the omission is visible. Nothing forces the call; if prompting
  proves not enough, the loop can add one more step that asks for the report before ending.
- Call ids come from the model API and appear in the model's context. A model that mistypes one gets
  `unknown` and is told so.
- Evidence is limited to the same run. Citing a call from an earlier turn is `unknown`.
- Claims about the model's own reasoning ("I decided to...") have no tool call to cite and show as
  unsupported; the prompt tells the agent to leave those out of the report.
