# ADR 0008: MCP servers are configured by hand and their tools default to "ask"

- Status: accepted
- Date: 2026-11-13

## Context

MCP lets the agent use tools from outside Orbit. Two kinds of server matter: a **stdio** server is a
program Orbit starts on this machine, and an **HTTP** server is a remote service. Both are code or
text we do not control, and the web page that drives Orbit is itself untrusted input.

## Decision

1. **Config is a file, edited by hand.** `mcp.json` in the data folder lists the servers. There is
   no API and no UI to add or change one: a web page that could add a stdio server could run
   commands on the machine. The settings page shows status only. The file is read at start-up; a
   change needs a restart.
2. **Tools default to `write`.** An MCP tool is shown to the model as `mcp__<server>__<tool>` and
   goes through the normal policy: every turn the user approves it, with its arguments as the
   preview (there is no diff). Only tools the user lists in `readOnlyTools` are `read` and run
   freely. The server's own `readOnlyHint` is ignored, since that is a claim by the party we do not
   trust.
3. **Official SDK, both transports.** `@modelcontextprotocol/sdk` 1.32.2: stdio and Streamable HTTP.
   It lives in its own package so the dependency, which is large, stays out of core.
4. **A stdio server gets a small environment.** The configured `env` plus the SDK's safe list
   (`PATH`, `HOME`, ...), not Orbit's own environment, so an unrelated key is not handed over.
5. **HTTP needs https**, except for localhost, and the url may not contain credentials. Headers
   (for a token) are never shown or logged, and are removed from error text.
6. **Everything from a server is bounded.** Descriptions are stripped of control characters and cut
   to 500 characters, results to 20,000, schemas over 20,000 are skipped, names become valid
   function names or the tool is skipped, calls have a time limit and honour cancellation, images
   and other binary content are named, not inlined.
7. **One broken server does not matter.** A server that fails to start or times out is `failed`
   with a redacted reason; the others and Orbit carry on. An unusable `mcp.json` starts no servers
   and says why. A bad file is never silently ignored.
8. **Shutdown closes the connections**, which stops the child processes.

The tool's JSON Schema comes from the server and is passed to the model as is (`Tool.jsonSchema`).
Orbit only checks the arguments are an object; the server validates the rest.

## Consequences

- **An MCP server is outside the workspace sandbox.** It runs with the user's own rights and can
  read or write anywhere the user can. The sandbox and the diff preview only cover Orbit's built-in
  tools. The approval preview shows arguments, which is weaker than a diff. The user must trust the
  servers they configure; the settings page says so.
- A description can still carry hostile instructions; cleaning and a length cap reduce that, the
  system prompt says tool results are data, and approval gates anything that acts. None of this is
  a guarantee.
- Changes to the server list need a restart. There is no reconnect if a server dies mid-session:
  its calls fail with an error the model sees.
- Adding a server from the UI is deferred to the desktop app (chapter 16), where the settings UI is
  part of a trusted shell, and then only with a confirmation that shows the full command. Managing
  existing servers in the UI (toggle, details, per-tool ask/auto) is planned as chapter 22.
- Only tools are used. Resources, prompts, sampling and OAuth login are not implemented.
- Tool names are namespaced, so two servers cannot clash; a server with very long tool names
  loses those tools.
