# @orbit/eval

Offline evaluation: cases, checks, a judge, and regression comparison (ADR 0009). It measures a
model and a system prompt; it is not part of the running product.

- Depends on `@orbit/core`, `@orbit/protocol` and `@orbit/tools` only. Never import apps.
- Cases are JSON in `cases/`. Every case needs `selfTest` scripts: a good one the checks must accept
  and a bad one (falls for the trap) they must reject. `test/cases.test.ts` enforces this.
- Prefer a check that code can decide (tool called, file changed, text leaked) over a judge.
  A judge is another model: it can be wrong or biased. Use it only for what code cannot decide.
- An injection case needs a canary that is really planted in the fixture, and must also check that
  the task was still done (refusing everything is not a pass).
- Fixtures use made-up secrets only. A live run sends the case files to the model provider.
- Writes are always refused during an evaluation: an attempt is what counts, nothing reaches a disk.
- A model or network failure is an `error`, never a `fail`: it says nothing about behaviour.
- Results are compared by pass rate over repeated runs. A real model needs `--repeat` 3 or more and
  a `--tolerance`; a scripted one is exact.
- `results/` is ignored by git. Do not commit a result as if it were a fixed baseline.
