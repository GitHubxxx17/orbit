import { mkdtemp, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { openDatabase, openStores, SCHEMA_VERSION } from '../src/index.js';

let dir: string;
let file: string;

beforeEach(async () => {
  dir = await mkdtemp(path.join(tmpdir(), 'orbit-sqlite-'));
  file = path.join(dir, 'data', 'orbit.db');
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

const started = { type: 'run.started', agentId: 'a', workspace: '/w' } as const;

describe('persistence', () => {
  it('keeps events across a restart and carries on numbering', () => {
    const first = openStores(file);
    first.events.append('r1', started);
    first.events.append('r1', { type: 'user.message', text: '你好' });
    first.close();

    const second = openStores(file);
    expect(second.events.read('r1').map((e) => e.type)).toEqual(['run.started', 'user.message']);
    expect(second.events.append('r1', { type: 'run.completed' }).seq).toBe(3);
    second.close();
  });

  it('keeps sessions, their runs, titles and removals across a restart', () => {
    const first = openStores(file);
    first.sessions.create('s1');
    first.sessions.addRun('s1', 'r1');
    first.sessions.addRun('s1', 'r2');
    first.sessions.rename('s1', '有标题');
    first.sessions.create('s2');
    first.sessions.remove('s2');
    first.close();

    const second = openStores(file);
    expect(second.sessions.get('s1')).toMatchObject({ title: '有标题', runIds: ['r1', 'r2'] });
    expect(second.sessions.get('s2')).toBeUndefined();
    expect(() => second.sessions.create('s2')).toThrow(); // a removed id stays taken
    second.close();
  });
});

describe('append-only', () => {
  it('refuses to change or delete a stored event, even through raw SQL', () => {
    const stores = openStores(file);
    stores.events.append('r1', started);

    expect(() => stores.db.prepare("UPDATE events SET data = '{}'").run()).toThrow(/append-only/);
    expect(() => stores.db.prepare('DELETE FROM events').run()).toThrow(/append-only/);
    expect(stores.events.read('r1')).toHaveLength(1);
    stores.close();
  });

  it('refuses two events with the same sequence number for a run', () => {
    const stores = openStores(file);
    stores.events.append('r1', started);
    expect(() =>
      stores.db
        .prepare(
          "INSERT INTO events (run_id, seq, id, ts, type, data) VALUES ('r1', 1, 'x', 0, 't', '{}')",
        )
        .run(),
    ).toThrow();
    stores.close();
  });
});

describe('safety', () => {
  it('creates the data folder and file readable by the current user only', async () => {
    openStores(file).close();
    expect((await stat(path.dirname(file))).mode & 0o777).toBe(0o700);
    expect((await stat(file)).mode & 0o777).toBe(0o600);
  });

  it('says so plainly when a stored event cannot be read, instead of skipping it', () => {
    const stores = openStores(file);
    stores.db.pragma('foreign_keys = OFF');
    // Bypass the store to plant a row that no longer matches the schema.
    stores.db
      .prepare(
        "INSERT INTO events (run_id, seq, id, ts, type, data) VALUES ('r1', 1, 'x', 0, 'run.started', '{\"bad\":true}')",
      )
      .run();
    expect(() => stores.events.read('r1')).toThrow(/unreadable/);
    stores.close();
  });

  it('refuses a database written by a newer version', () => {
    const stores = openStores(file);
    stores.db.pragma(`user_version = ${SCHEMA_VERSION + 1}`);
    stores.close();

    expect(() => openDatabase(file)).toThrow(/newer than this program understands/);
  });

  it('turns on write-ahead logging for file databases', () => {
    const stores = openStores(file);
    expect(stores.db.pragma('journal_mode', { simple: true })).toBe('wal');
    stores.close();
  });
});
