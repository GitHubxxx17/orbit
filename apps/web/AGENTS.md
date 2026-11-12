# @orbit/web

React 19 + Vite + Tailwind CSS 4 UI.

- UI state is a projection of the event log; do not keep a second source of truth.
- Streaming updates arrive many times per second: keep message components memoized and avoid
  re-rendering the whole list per delta.
- Function components and hooks only. Follow the Rules of Hooks (enforced by ESLint).
- Style with Tailwind utility classes; no inline style objects unless a value is dynamic.
- Import event types and schemas from `@orbit/protocol`; never import `@orbit/core`.
- Interactive elements must be keyboard accessible and have accessible names.
