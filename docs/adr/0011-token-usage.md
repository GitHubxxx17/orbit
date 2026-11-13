# ADR 0011: Token usage is an event, and "unknown" is never shown as zero

- Status: accepted
- Date: 2026-11-13

## Context

The model adapter has always asked the provider for token usage, but the agent loop threw it away,
so nothing could show what a turn cost. With the step limit gone (ADR 0010), a long job can spend
real money and the user needs to see it.

## Decision

1. **A new event, `model.usage { promptTokens, completionTokens }`**, appended once for each model
   call that finishes, in the order the calls happened. It is an increment: old logs stay valid.
   The wrap-up call after an early stop is recorded too.
2. **Only what the provider reports.** If it reports nothing (some gateways ignore
   `stream_options`, and the scripted demo model never does) no event is written. A missing event
   means unknown, and the UI says "用量未知" for a real model, never `0 token`.
3. **A turn adds its calls up.** The line under an answer reads `model · time · input · output
token`, and the number of calls when there was more than one. It is shown for finished runs and
   for runs ended early (they still cost something), not for failures.
4. **Tokens, not money.** Prices differ by model and change, so no price table is built in.

## Consequences

- The numbers are the provider's own, so they match the provider's bill, but a provider may count
  differently from another; they are not comparable across models.
- A fork copies the usage events of the turns it copies, so a fork shows the cost those turns had
  in the original session. Opening both sessions does not mean paying twice.
- Not done: a session total, a per-run budget that stops a run, a context-window gauge (the last
  call's input tokens would give it), and cost in money.
