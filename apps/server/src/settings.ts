import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

/** One saved model. The key lives only here (and in .env), never in the database or logs. */
const StoredModel = z.object({
  id: z.string().min(1),
  label: z.string().min(1),
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
});
export type StoredModel = z.infer<typeof StoredModel>;

export interface StoredModels {
  models: StoredModel[];
  /** The model new conversations use; one of `models`, or null when the list is empty. */
  defaultId: string | null;
}

/** The first version kept a single model without an id; it is read as a list of one. */
const LegacyModel = z.object({
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
});

const SettingsFile = z.object({
  models: z.array(StoredModel).optional(),
  defaultId: z.string().optional(),
  model: LegacyModel.optional(),
});

/** The id the migrated single model gets. */
export const LEGACY_ID = 'default';

/**
 * User settings in one JSON file. It holds API keys, so the folder is private to the current
 * user, the file is 0600, and writes go through a temp file so a crash never leaves half a key.
 */
export class SettingsStore {
  constructor(private readonly file: string) {}

  /** The saved models; empty when none is saved or the file is unreadable. */
  read(): StoredModels {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const parsed = SettingsFile.parse(raw);
      const models =
        parsed.models ??
        (parsed.model
          ? [{ ...parsed.model, id: LEGACY_ID, label: parsed.model.model } satisfies StoredModel]
          : []);
      const defaultId = models.some((m) => m.id === parsed.defaultId)
        ? (parsed.defaultId ?? null)
        : (models[0]?.id ?? null);
      return { models, defaultId };
    } catch {
      return { models: [], defaultId: null };
    }
  }

  /** Always writes the current format, so an old single-model file is upgraded on first save. */
  write(settings: StoredModels): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    const body = JSON.stringify(
      settings.models.length > 0 ? { models: settings.models, defaultId: settings.defaultId } : {},
      null,
      2,
    );
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
