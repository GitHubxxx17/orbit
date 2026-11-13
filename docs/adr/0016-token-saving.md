# ADR 0016: Spend fewer tokens: measure the cache, change history rarely, do not read twice

- Status: accepted
- Date: 2026-11-13

## Context

Every model call re-sends the whole conversation. One "summarise this project" run made 17 calls
and sent about 174.5k input tokens, mostly the same history again and again. Providers charge much
less for the part of a request that starts exactly like a recent one (a prompt cache), but Orbit
rewrote its history a little on every step (it kept the newest 6 tool outputs and masked the rest),
so each request differed from the last near the start and the cache could not apply. There was also
no way to see any of this: only prompt and completion tokens were recorded.

Sources: DeepSeek's [context caching guide](https://api-docs.deepseek.com/zh-cn/guides/kv_cache)
(a request hits only if it fully matches a cached prefix unit; hits are reported in
`prompt_cache_hit_tokens`; the cache is best-effort and built in seconds), OpenAI's
[prompt caching](https://developers.openai.com/api/docs/guides/prompt-caching) (automatic, prefix
based, reported as `cached_tokens`), and JetBrains' study
[Simple Observation Masking Is as Efficient as LLM Summarization](https://arxiv.org/abs/2508.21433).

## Decision

1. **Measure first.** `model.usage` gains an optional `cachedTokens`. The adapter reads it per
   provider (`cachedTokensOf`): DeepSeek's `prompt_cache_hit_tokens`, and the OpenAI-style
   `prompt_tokens_details.cached_tokens`. A provider that says nothing gives no field: unknown is
   not 0, and a turn shows a hit rate only if every one of its calls reported. Other providers are
   added by adding their field to that one function, with a test.
2. **Change history rarely, so the prefix stays the same.** `ContextWindow` replaces the per-step
   trimming. Old tool outputs are masked in one go, when the conversation has grown to 70% of the
   model's window, and then left alone until it grows that far again. Between those moments each
   request is the previous one plus what was just added, which is exactly what a prefix cache
   rewards. The mask only moves forward, keeps the newest tool outputs that fit in half the trigger
   size and the whole latest batch,
   and leaves a note naming the tool, its arguments and how much was dropped, so the call is still
   on record (as in Anthropic's context editing). Dropping whole exchanges stays as a last resort
   at 90% of the window.
3. **Count in real tokens.** After each call the provider's `prompt_tokens` is compared with the
   characters sent, which turns characters into tokens for the next check. The window comes from the
   model settings (`contextWindow`, optional, typed as 128k or 1m): it is not guessed from the model
   name. Without it, the old character budget applies and nothing about the window is shown.
4. **Do not read twice.** A tool may be marked `idempotent` (the three read tools are). If the model
   repeats the exact call while its earlier result is still in the conversation and nothing that
   could write has run since, it gets a short note instead of the same text again. A masked result
   no longer counts, so the call runs again. The note is recorded as the tool result, so replay shows
   what the model was told.
5. **Show it.** The line under a turn adds "cache hit n%" when known; the input box shows how full
   the window is (used, free, total in the tooltip) when the window is set.

## Consequences

- The first request after a mask is a full cache miss from the point of the change; masking is
  therefore rare and large, not frequent and small.
- Whether a provider's cache hits is up to the provider (the DeepSeek guide calls it best-effort).
  Orbit's part is to not break the prefix and to show the result.
- Not done: LLM summaries of old history (the study found masking about as good), loading tool
  descriptions on demand (few tools), a user-set compaction threshold (fixed at 70%), a measured
  baseline: the evaluation needs a real model, so before/after numbers are the user's to run.

## What the first real run showed

A real run (DeepSeek, "summarise this project", no window set) made 42 calls and sent 688k input
tokens, 84% of them served from the cache. The cache part worked: the input grew from 1.2k to
about 24k tokens, dropped when old outputs were masked, and grew again, with hits recovering after
each drop. But the run ended early as a loop, and the answer said it could not verify several
files. The log showed why: of 71 tool calls, 63 were distinct, and the repeats were files the model
had read and then lost to masking (the same file three times). Masking at a fixed small count
(6 outputs) threw away what a broad exploration needs, the model had no notes to fall back on, and
the loop check counted the forced re-reads as going in circles. Changes made because of it:

1. Masking keeps the newest outputs that fit in half the trigger, not a fixed 6.
2. The system prompt asks the model to note what it learns from each file in its own messages
   (those are never masked), and the placeholder points to those notes.
3. A read whose earlier result was masked does not count towards the loop limit.
4. With no window set, the fixed 120k-character budget triggers masking at about 24k tokens, which
   is far too early for a large-window, cache-friendly model such as the one above. Setting the
   model's window in its settings is what makes the trigger scale.

## Fewer round trips (after comparing with Codex)

The same question ("summarise this project") took Codex 7 model calls and Orbit 42. Each call
sends the whole conversation again, so the number of calls matters more than the size of any one
answer. The log showed why: 66 `read_file` calls over 42 model calls, 22 of those calls asking for
a single file, because the only tools were one-file-at-a-time and a one-level directory listing.
Codex batches its reads in shell commands and starts from the files that summarise the project
(README, AGENTS.md, architecture notes). Orbit has no shell (ADR 0002 requires an ADR before
running commands), so it gets the same effect from read-only tools:

1. **`read_files`**: up to 20 files per call, each with its own line range, one output cap for the
   whole call. A file that cannot be read (denied, missing, binary) is reported in its place and
   does not fail the others; files that do not fit are listed so they can be asked for again.
   It goes through `readLines`, the same code and the same sandbox as `read_file`.
2. **`list_dir` with `depth`** (1 to 4): the tree below a directory in one call. Links are shown,
   never followed.
3. **A prompt section** asking for few round trips: read the summarising files first, ask for
   everything in one turn, read only the lines needed, and stop once the question can be answered.

The risk is quality: reading less can make an overview thinner. The evaluation (ADR 0009) is the
check, comparing pass rate as well as tokens.
