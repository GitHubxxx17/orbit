# ADR 0010: No small step limit; stop only for being stuck, and still give an answer

- Status: accepted
- Date: 2026-11-13

## Context

The agent loop stopped a run after 10 model calls and ended it as failed. A real open question
("summarise what this project does") needed 10 calls and 26 tool calls and then produced no answer
at all: all the work was thrown away. Other products avoid that: Cursor pauses and asks the user to
continue, Cline removed its request limit, and agent SDKs let the developer turn the limit off or
return a controlled final output instead of an exception. A small cap is a tool for developers
running unattended programs; Orbit is used by a person who can press Stop.

## Decision

1. **The cap becomes a safety ceiling.** The default goes from 10 to 100 model calls. It only
   protects against a runaway that nothing else caught.
2. **Being stuck is detected, not counted.** A call that returns the same result as the last time
   it was made with the same tool and arguments (arguments compared as parsed JSON, so spacing does
   not matter) is a repeat. Three repeats in a row end the run. A call whose result changed, for
   example reading a file after writing it, is not a repeat.
3. **Stopping gives an answer.** When Orbit ends a run because of 2, or because of the ceiling, it
   asks the model once more, without offering any tools, to answer from what it has read and to
   say what it could not finish. A tool call made anyway is ignored. The answer is recorded as normal
   message events.
4. **The run still ends as `failed`**, with the reason `stopped early: loop` or `stopped early: steps`
   (`EARLY_STOP_PREFIX` in the protocol package). The answer is in the log; the reason says it may
   be incomplete. No new event type. The web app shows it as an amber notice under the answer, not
   a red error, and the session list does not flag it.
5. **A user's Stop is not changed.** It ends the run at once, with no further model call.

## Consequences

- A long job can now run for a long time and spend the user's money. The step count is visible while
  it runs and Stop works at any moment. Nothing limits cost per run yet.
- Loop detection only catches exact repeats. A model that keeps trying slightly different calls is
  not caught until the ceiling, so the ceiling stays.
- The wrap-up message to the model is not an event, so it is not in the rebuilt history of later
  turns; the answer it produced is.
- `@orbit/eval` keeps its own small default of 10 calls on purpose: its cases are tiny, and a model
  that needs more is itself a result.
- Not done: a per-run cost or token budget, and a Cursor-style pause that asks "continue?".
