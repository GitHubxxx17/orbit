# @orbit/server

Local HTTP server (Hono).

- Keep `createApp(deps)` free of side effects so tests can call `app.request(...)` directly.
  Process wiring (port, listen) belongs only in `src/main.ts`.
- Bind to `127.0.0.1`. Never `0.0.0.0`.
- Validate all path, query and body input with zod; return 400 with a JSON `{ error }` on bad input.
- Stream run events over SSE; stop model and tool work when the client disconnects.
- Never log request bodies or headers that may contain API keys.
