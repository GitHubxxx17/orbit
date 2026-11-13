# @orbit/mcp

MCP client: connects to the servers in `mcp.json` and turns their tools into Orbit tools (ADR 0008).

- Depends on `@orbit/core`, `@orbit/protocol` and the official `@modelcontextprotocol/sdk` only.
- Servers come from a file the user edits by hand. Never add a way to change the list over HTTP or
  from the web app: a stdio server is a program started on this machine.
- An MCP tool is `risk: 'write'` unless the config lists it in `readOnlyTools`. Never trust a
  server's own annotations (`readOnlyHint`) to lower the risk.
- Everything a server sends is untrusted: descriptions are cleaned and capped, results are capped,
  binary content is named and not inlined, schemas have a size limit.
- A stdio server gets only the configured `env` plus the SDK's short safe list. Never pass
  `process.env` through.
- Error text shown to the user goes through `redact`; config errors name the setting, never its value.
- One broken server must not stop the others or Orbit: failures become `state: 'failed'`.
- Tests start real servers: a stdio child process (`test/fixtures/server.mjs`) and an in-process
  Streamable HTTP server. Do not mock the SDK.
