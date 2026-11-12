# Contributing

## Workflow

- Branch from `main`; open a pull request; CI (`pnpm check`) must pass.
- Commits follow [Conventional Commits](https://www.conventionalcommits.org/), enforced by commitlint
  (for example `feat(core): add replay`).
- Pre-commit runs lint-staged (prettier + eslint on staged files).

## Conventions

- TypeScript strict mode; shared types live in `@orbit/protocol` and are defined as zod schemas.
- Internal packages export TypeScript source directly (no build step) except apps.
- Dependencies are pinned to exact versions.
- Non-trivial design choices are recorded in `docs/adr/` before they are implemented.
- Never commit secrets. `.env` is git-ignored; use `.env.example` for new variables.
