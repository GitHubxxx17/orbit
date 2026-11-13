# ADR 0015: An archive, and deleting a conversation for good

- Status: accepted
- Date: 2026-11-13
- Narrows the rule "never delete a stored event" (ADR 0001, ADR 0004) in one place.

## Context

Removing a conversation only hid it (`removed = 1`) and there was no way to see or undo that, so
the "remove" button was both timid (nothing was ever freed) and unrecoverable in practice. Users
expect what other tools have: an archive that lists what was removed, lets them bring it back, and
lets them delete it for good. Deleting for good has to delete the events, which the append-only
rule forbids.

## Decision

1. **Removing a conversation archives it.** It leaves the list; nothing is deleted. The button now
   says "archive". `GET /archive` lists archived conversations; `POST /archive/:id/restore` brings
   one back unchanged (title, runs, workspace).
2. **Deleting for good is a separate, confirmed step on an archived conversation only**
   (`DELETE /archive/:id`). It deletes every event of its runs, then forgets the conversation's runs
   and title. The session id stays taken (a tombstone row, `removed = 2`), so an id is never reused.
3. **The one exception to append-only, enforced by the database.** `EventStore.deleteRuns` removes
   whole runs and nothing else. In SQLite, schema version 2 replaces the "no delete" trigger with
   one that refuses a delete unless the event's run belongs to an archived conversation. Updating an
   event is still always refused. So no bug in the server can delete the history of a conversation
   that is in use, and no single event can ever be deleted or changed.
4. **Ordering and failure.** Events are deleted first (the trigger needs the conversation to still
   be archived), then the session record. If that is cut short, the archived conversation remains,
   with some or all runs empty, and can be deleted again. Nothing in the list is affected.
5. **Existing databases upgrade in place** (version 1 to 2, only the trigger changes; no data is
   touched). A version 2 database is refused by older code, as with any newer schema.
6. **The page asks twice.** The archive list shows a delete button; it turns into "permanently
   delete the chat and everything in it? cannot be undone" with a confirm button. There is no
   "delete all" yet.

## Consequences

- Forks copy events, so a fork of a deleted conversation keeps its own copy: deleting does not
  reach into other conversations.
- Backups of the database file still contain what was deleted until SQLite reuses the space; this is
  not a secure erase.
- Not done: automatic expiry of old archived chats, "delete all archived", restoring a conversation
  whose workspace was removed from the list (it comes back, but cannot be continued, ADR 0014).
