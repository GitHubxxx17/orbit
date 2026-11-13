# ADR 0014: Workspaces are registered on the server and chosen by id

- Status: accepted
- Date: 2026-11-13

## Context

The server had exactly one workspace, fixed when it started, and the tools, the sandbox and the
rollback were all built once for it. Working on another project meant restarting with another
`ORBIT_WORKSPACE`, and all conversations were mixed in one list.

A workspace is a folder the agent may read and, with approval, write. Letting the web page name
that folder would let any page that can reach the server point the agent at `~/.ssh`.

## Decision

1. **The server owns the list.** The workspace it was started in is always registered first. More
   are kept in `workspaces.json` in the data folder (0600), which can also be edited by hand, like
   `mcp.json` (ADR 0008).
2. **A folder is added through the operating system's own dialog, opened by the server.**
   `POST /workspaces/pick` makes the server show the native "choose folder" window on the machine
   it runs on (macOS for now, through `osascript` with fixed arguments and no shell) and registers
   what the person there picks. The request may carry a display name and nothing else: the body is
   strict, so a `path` is refused with 400. No request can put a folder on the list that a human
   did not choose in that dialog. This is what makes adding from the page safe: a page, a script
   or an injected prompt can ask for the dialog but cannot answer it. `DELETE /workspaces/:id`
   forgets one (the folder and the conversations are untouched). One dialog at a time (409); an
   unsupported platform gets 501 and the hand-edited file still works.
3. **The page chooses by id, never by path.** `POST /runs` takes an optional `workspaceId`; an
   unknown id is refused with 400, and a path is just an unknown id. Ids are derived from the real
   path (`w-` plus a hash), so they survive restarts and reordering.
4. **Each workspace has its own tools and rollback**, built with a sandbox on its folder (the same
   code as before). `report` and the tools from MCP servers are shared by all of them. MCP servers
   run outside every workspace sandbox, as before.
5. **A conversation keeps its workspace.** It is the one its first run recorded in `run.started`
   (the event already held the path; no new field). Continuing it uses that workspace; asking for a
   different one is a 400. If that folder is no longer registered the conversation can still be
   read and replayed but not continued (409).
6. **Rollback is confined too**: an undo runs through the workspace the run worked in.
7. **Too-broad folders are refused**, whether from the file or the dialog: the disk root and the whole home folder, so a typo
   cannot give the agent every document and key. Bad entries are skipped and shown on the settings
   page with the reason; one bad entry does not stop the others. The starting workspace is the
   operator's own choice and is not subject to this check.
8. **The list is grouped by workspace.** `SessionSummary` gets `workspace` and `workspaceName`,
   derived from the event log like everything else in it.
9. Adding or removing through the page takes effect at once. A file edited by hand is read when the
   server starts. A file that could not be read is never overwritten by the page.

## Consequences

- Old conversations keep working: their recorded path matches the starting workspace as long as
  it is the same folder.
- A dialog on a server that runs on another machine would open there, not for the user; Orbit
  binds to loopback only, so the server and the user are on the same machine.
- Not done: other platforms' dialogs (Linux, Windows), per-workspace agent or policy settings,
  per-workspace MCP, hot reload of a hand-edited file.
