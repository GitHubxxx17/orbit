# ADR 0017: The evidence report is off by default

- Status: accepted
- Date: 2026-11-13
- Changes the default of ADR 0007; the feature itself stays.

## Context

ADR 0007 has the agent end each run by calling a `report` tool whose claims cite the tool calls
that prove them, and checks the citations against the event log. In use it turned out to help
little:

- It costs a model call, and the report's text is often thousands of tokens, on top of the answer
  it repeats.
- Once old tool outputs are masked to save tokens (ADR 0016), the model often cannot cite a call
  any more. In a real run on DeepSeek all 11 claims came back "unverified", with the first claim
  saying the call ids were no longer available. A card full of red labels is noise, not evidence.
- The check only proves that a cited call really ran and succeeded, not that it shows the claim
  (ADR 0007 says so). The user judged it not worth its cost for now.

## Decision

1. **The server does not give the agent the `report` tool unless `ORBIT_REPORT=1` is set.** Nothing
   is deleted: the tool, `checkReport`, the report card and the evaluation cases stay, and the
   switch turns them back on.
2. **The prompt follows the tool.** `buildSystemPrompt({ report })` includes the reporting rules
   only for a run that has the tool; asking for a report the model cannot make would only confuse
   it. `DEFAULT_SYSTEM_PROMPT` is still the full prompt, which is what the evaluation measures.
3. **The page follows the server.** `GET /info` says whether reporting is on (`report`). The
   "the agent did not submit a report" notice is shown only then. A report card in an old
   conversation is still shown, because it comes from the event log.
4. Agent profiles keep `report` whenever the server has it; with it off there is nothing to keep.

## Consequences

- A run is one model call shorter and the final answer is the only summary.
- Claims in answers have no automatic citation check by default. The prompt still asks for file
  paths and line numbers, and the process view shows every tool call.
- To bring it back, set `ORBIT_REPORT=1` and restart the server. A future version could report
  from the event log without asking the model (the same check, no extra call).
