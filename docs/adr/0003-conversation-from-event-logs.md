# ADR 0003: Derive the conversation from event logs

- Status: accepted
- Date: 2026-11-12

## Context

Until now every run started with an empty conversation, so a follow-up question could not refer
to the previous answer. Multi-turn use needs the earlier turns to reach the model. The obvious
route, a separate mutable "messages" store per conversation, would be a second source of truth
next to the event log (ADR 0001) and could disagree with it.

## Decision

1. A **session** is an ordered list of runs. The conversation the model sees is **derived**: a
   pure function (`historyFromRuns`) rebuilds the messages from those runs' event logs.
2. To make that possible, the log records what the user asked: a new `user.message` event
   follows `run.started`. This is an additive protocol change; logs without it stay valid.
3. The server hands out session ids; a client cannot invent one. A session runs one run at a time.
4. What is sent to the model is kept inside a size budget by a pure function (`fitToBudget`):
   old tool outputs are replaced by a short note, then the oldest whole exchanges (a user message
   and everything up to the next one) are dropped. The system prompt and the newest exchange are
   never dropped. The budget is counted in characters, a stand-in for tokens.
5. The system prompt lives in one reviewed module, with a test that guards the rules that defend
   against prompt injection (tool results are data, rejections are final).

## Consequences

- There is still one source of truth. Replay, fork and the UI all read the same logs.
- The rebuilt history is faithful but not byte-identical: wording the model saw that is not in an
  event (for example why a call was refused) is reconstructed as a paraphrase.
- Dropping whole exchanges keeps every assistant tool call next to its answers, which model APIs
  require, but a very long single exchange cannot be shortened below its own size.
- Characters are not tokens: the budget is conservative and model-agnostic, not exact. A real
  tokenizer and model-written summaries of dropped turns are possible later.
- Sessions are held in server memory, so they are lost on restart until events are persisted.
