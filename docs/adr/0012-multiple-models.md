# ADR 0012: Several saved models, chosen per run

- Status: accepted
- Date: 2026-11-13
- Supersedes the single-model parts of ADR 0005 (the key is still write-only and the file is still private).

## Context

Settings held exactly one model. Trying another provider meant overwriting the first, and the
next planned feature (one agent per model, plan item 15) needs more than one to exist at once.

## Decision

1. **`settings.json` holds a list**: `{ models: [{ id, label, baseUrl, apiKey, model }], defaultId }`.
   An old file with a single `model` is read as a list of one (id `default`) and written in the new
   format on the first save. Nothing is lost and nothing needs a migration step.
2. **The `.env` model is a read-only entry** (`id: env`) shown only while nothing is saved. Saving a
   model replaces it; removing the last saved one brings it back.
3. **New routes replace `/settings/model*`**: `GET/POST /settings/models`, `PUT/DELETE
/settings/models/:id`, `PUT /settings/default-model`, `POST /settings/models/test`, and
   `GET /settings/balance?model=`. No response ever contains a key; only the last characters.
4. **A run names its model**: `POST /runs` takes an optional `modelId` (the default when omitted;
   400 for an unknown one). The id is checked against the server's list, never trusted as a URL
   or key.
5. **`run.started` gains an optional `model`**, the model name for a live run. Old logs have none,
   so the line under an answer falls back to the current default for them. It is optional on
   purpose: stored logs stay valid.
6. **A connection test never borrows another model's key.** It uses the key typed in the form, or
   that of the model named by `id` (editing). A new model with no key is refused, so a key can not
   be sent to a host the user never paired it with.
7. **Appearance (font size, content width) is browser-local**, kept in `localStorage` and applied
   as CSS variables. It is a taste of this browser, so the server does not store it.

## Consequences

- Balance is looked up per model and cached per model; saving anything clears the cache.
- Deleting a model does not touch old conversations: their `run.started` keeps the name it ran with.
- Not done here: per-agent model choice (item 15), grouping or reordering models, importing keys.
