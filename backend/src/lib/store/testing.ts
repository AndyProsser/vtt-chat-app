import { randomUUID } from 'node:crypto';

import pg from 'pg';

import { migrate } from './migrate.js';
import { MemoryStore } from './memoryStore.js';
import { createPool, PostgresStore } from './postgresStore.js';
import type { Store } from './store.js';

/**
 * Point this at a scratch Postgres to run the store-backed suites against the real thing as well:
 *
 *   TEST_DATABASE_URL=postgres://postgres:scratch@127.0.0.1:55432/vtt npm test -w @vtt-chat-app/backend
 *
 * Unset, everything runs against `MemoryStore` and CI needs no database.
 */
export const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL;

export interface TestBackend {
  readonly kind: 'memory' | 'postgres';
  /** The current store; replaced by {@link reset}. */
  store: Store;
  /** Unique ids in the form the store needs (`UUID` columns reject arbitrary strings). */
  newId: () => string;
  /** A clean store: a fresh `MemoryStore`, or every table emptied. Returns it. */
  reset: () => Promise<Store>;
  close: () => Promise<void>;
}

/**
 * One backend per test file. Postgres runs in its own throwaway schema (via `search_path`) so test
 * files running in parallel workers can't see each other's rows; the schema is dropped on close.
 */
export async function openTestBackend(): Promise<TestBackend> {
  if (TEST_DATABASE_URL === undefined) {
    let counter = 0;
    const backend: TestBackend = {
      kind: 'memory',
      store: new MemoryStore(),
      newId: () => `id-${++counter}`,
      reset: async () => (backend.store = new MemoryStore()),
      close: async () => undefined,
    };
    return backend;
  }

  const schema = `t_${randomUUID().replaceAll('-', '')}`;
  const admin = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await admin.connect();
  await admin.query(`CREATE SCHEMA ${schema}`);

  // `options` is applied at connection start, so every pooled connection lands in the test schema.
  const pool = createPool(TEST_DATABASE_URL, { options: `-c search_path=${schema}` });
  await migrate(pool);

  const store = new PostgresStore(pool);
  const backend: TestBackend = {
    kind: 'postgres',
    store,
    newId: randomUUID,
    reset: async () => {
      // CASCADE clears the dependants; the settings row is re-seeded by hand below.
      await pool.query(
        `TRUNCATE invites, memberships, characters, campaigns, magic_links, sessions, users,
           instance_settings CASCADE`,
      );
      await pool.query('INSERT INTO instance_settings (id) VALUES (1)');
      return store;
    },
    close: async () => {
      await pool.end();
      await admin.query(`DROP SCHEMA ${schema} CASCADE`);
      await admin.end();
    },
  };
  return backend;
}
