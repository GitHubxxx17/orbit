# @orbit/web

React 19 + Vite + Tailwind CSS 4 UI.

- UI state is a projection of the event log; do not keep a second source of truth.
- Streaming updates arrive many times per second: keep message components memoized and avoid
  re-rendering the whole list per delta.
- Function components and hooks only. Follow the Rules of Hooks (enforced by ESLint).
- Style with Tailwind utility classes; no inline style objects unless a value is dynamic.
- Import event types and schemas from `@orbit/protocol`; never import `@orbit/core`.
- UI primitives come from shadcn/ui (`src/components/ui/`, added with
  `pnpm dlx shadcn@latest add <name>` from `apps/web`); product components live in
  `src/components/`. Use the `@/` alias for imports inside `src`.
- Pin every dependency version the shadcn CLI adds (it writes `^` ranges).
- Tests live in `test/` and cover pure state logic (`src/state/`), not rendering details.
- Interactive elements must be keyboard accessible and have accessible names.
- A conversation is a list of per-run views (`state/session.ts`); events always go to the newest
  one. Earlier turns are finished and must keep their identity so they do not re-render.
