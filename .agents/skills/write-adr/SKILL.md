---
name: write-adr
description: Record an architecture decision in docs/adr. Use for contract changes, new major dependencies, or security-relevant choices.
---

# Write an ADR

1. List `docs/adr/` and take the next number, zero-padded to four digits.
2. Create `docs/adr/NNNN-short-kebab-title.md` with: Status, Date, Context, Decision, Consequences.
3. Context states the problem and constraints; Decision is one clear choice; Consequences lists
   costs and follow-ups honestly, including what becomes harder.
4. If it supersedes an earlier ADR, set that ADR's status to `superseded by NNNN`.
5. Use the actual current date. Do not invent benchmarks or version claims; verify with commands.
6. Run `pnpm format` so Prettier accepts the file.
