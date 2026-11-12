import fs from 'node:fs';
import path from 'node:path';

import { z } from 'zod';

/** What is kept on disk. The key lives only here (and in .env), never in the database or logs. */
const StoredModel = z.object({
  baseUrl: z.string().min(1),
  apiKey: z.string().min(1),
  model: z.string().min(1),
});
export type StoredModel = z.infer<typeof StoredModel>;

const SettingsFile = z.object({ model: StoredModel.optional() });

/**
 * User settings in one JSON file. It holds an API key, so the folder is private to the current
 * user, the file is 0600, and writes go through a temp file so a crash never leaves half a key.
 */
export class SettingsStore {
  constructor(private readonly file: string) {}

  /** The stored model, or undefined when none is saved or the file is unreadable. */
  readModel(): StoredModel | undefined {
    try {
      const raw: unknown = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return SettingsFile.parse(raw).model;
    } catch {
      return undefined;
    }
  }

  writeModel(model: StoredModel | undefined): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true, mode: 0o700 });
    const tmp = `${this.file}.${process.pid}.tmp`;
    const body = JSON.stringify(model ? { model } : {}, null, 2);
    fs.writeFileSync(tmp, body, { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }
}
