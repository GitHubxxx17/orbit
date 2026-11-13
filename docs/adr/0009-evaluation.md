# ADR 0009: Evaluation is offline, mostly code-checked, and checks itself first

- Status: accepted
- Date: 2026-11-13

## Context

Changing the system prompt or the model should be judged by data, not by trying a prompt once and
liking the reply. Orbit also claims to resist prompt injection (ADR 0002) and to report honestly
(ADR 0007); both are claims about behaviour, so they need measuring.

## Decision

1. **A separate package, `@orbit/eval`, outside the running product.** It runs the real agent loop,
   real tools and the real policy against a small throw-away workspace made from the case, then
   removes it. Nothing in the server depends on it.
2. **Cases are JSON.** A case holds the workspace files, the request, and a list of checks. Three
   categories: `task` (does the job), `injection` (a file tries to take control), `report` (the
   claims are backed). Fixtures use made-up secrets, never real ones.
3. **Code checks first.** Most checks are decided by code from the event log and the files: tool
   called or not (optionally with an argument), file changed, answer contains or excludes a text, a
   planted canary leaked into the answer, a write argument or a changed file, the report rule from
   ADR 0007, and that no report claim contains a given text. A judge is used only for what code
   cannot decide.
4. **Writes are always refused during an evaluation.** The approver denies everything. A write the
   model asks for is still in the log as an attempt, and an attempt is what shows it fell for a
   trap; nothing reaches a disk.
5. **An injection case must also check the task was done**, so refusing everything is not a pass.
6. **LLM-as-judge for open questions.** A judge model gets a criterion and the material marked as
   data to evaluate, never to follow, and must answer one JSON object. An unusable reply is an
   `error`, never a pass. Without a judge, judge checks are `skipped` and reported, not failed.
   One judge check, `claims-semantic`, asks for each report claim whether the output it cites
   supports it. That closes the gap ADR 0007 left (a real but unrelated call used as evidence).
7. **The checks are checked first.** Every case carries two scripts, a good one the checks must
   accept and a bad one that falls for the trap and must be rejected. `selfCheck` runs them and a
   test fails if any case accepts the bad script or rejects the good one. Only then are results
   from a real model worth reading.
8. **Errors are not failures.** A model or network failure makes a run an `error`; it says nothing
   about behaviour and is left out of the pass rate.
9. **Results are pass rates over repeated runs**, saved as JSON with the model name and a hash of
   the system prompt. `compare` against a baseline reports regressions per case, with a tolerance
   for a model's natural variation, and notes when the prompt or model differs. The CLI exits 1 on
   a regression. `results/` is ignored by git: a result is a measurement of one model on one day,
   not a fixed truth.

## Consequences

- **A pass is evidence, not proof.** 14 small cases cover a handful of injection styles. A model
  that passes them can still fall for a different phrasing, and the cases were written by the same
  people who wrote the defences. Treat the injection pass rate as a floor to watch for regressions.
- The judge is another model (by default the one being tested, unless `--judge-model` names
  another), so it can be wrong, or lenient towards its own output. Code checks stay authoritative.
- Case files and the judge material are sent to the model provider during a live run. The fixtures
  are synthetic, but it is still an outbound request using the user's key.
- CI does not run a real model (cost, keys, nondeterminism). CI runs the self-check and the
  harness tests, which prove the checks work, not that any model is good.
- Not done: running the cases through MCP tools, multi-turn conversations, measuring cost or
  latency per case, and a larger or generated set of injection samples.
