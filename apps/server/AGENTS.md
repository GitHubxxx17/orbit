# @orbit/server

Local HTTP server (Hono).

- Keep `createApp(deps)` free of side effects so tests can call `app.request(...)` directly.
  Process wiring (port, listen) belongs only in `src/main.ts`.
- Bind to `127.0.0.1`. Never `0.0.0.0`.
- Validate all path, query and body input with zod; return 400 with a JSON `{ error }` on bad input.
- Stream run events over SSE (`GET /runs/:id/stream`, resumable via `Last-Event-ID`). A run does
  not depend on its stream: closing the stream only unsubscribes, and a run is stopped explicitly
  with `POST /runs/:id/cancel`. Starting runs requires `application/json` and a loopback `Host`.
- Never log request bodies or headers that may contain API keys.
- A session id is only valid if the server issued it, and a session has one run at a time.
  Sessions live in memory until events are persisted.
- API response shapes live in `@orbit/protocol` (`src/api.ts`) so the web app can validate them.
  Session titles and snippets are derived from event logs (`session-summary.ts`), never stored.
