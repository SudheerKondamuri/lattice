import { afterAll, beforeAll, expect, it } from 'vitest';
import EmbeddedPostgres from 'embedded-postgres';
import { mkdir, readFile, mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { createDatabase, type Database } from '../src/db.js';
import { reserve, settle, usage } from '../src/usage.js';
import { testConfig } from './helpers.js';

let server: EmbeddedPostgres;
let db: Database;
beforeAll(async () => {
  const parent = fileURLToPath(new URL('../.test-data/', import.meta.url));
  await mkdir(parent, { recursive: true });
  const dir = await mkdtemp(`${parent}ledger-`);
  server = new EmbeddedPostgres({
    databaseDir: dir,
    port: 55439,
    user: 'lattice_test',
    password: 'isolated_local_test',
    persistent: false,
    onLog: () => {},
    onError: () => {},
  });
  await server.initialise();
  await server.start();
  await server.createDatabase('lattice_test');
  db = createDatabase({
    ...testConfig,
    DATABASE_URL: 'postgres://lattice_test:isolated_local_test@127.0.0.1:55439/lattice_test',
    DATABASE_POOL_SIZE: 8,
  });
  // Use exact production ledger DDL. Vector/release/RLS migrations run separately on PGlite.
  const migration = await readFile(new URL('../migrations/0000_core.sql', import.meta.url), 'utf8');
  await db.system(async (tx) => {
    for (const table of ['workspaces', 'subscriptions', 'usage_events', 'spend_days']) {
      const ddl = migration.match(new RegExp(`CREATE TABLE ${table} \\([\\s\\S]*?\\n?\\);`))?.[0];
      if (!ddl) throw new Error(`Production DDL missing: ${table}`);
      await tx.exec(ddl);
    }
  });
}, 60000);
afterAll(async () => {
  if (db) await db.close();
  if (server) await server.stop();
});
it('native PostgreSQL row locks serialize eight concurrent reservations at the final quota unit', async () => {
  const w = randomUUID();
  await db.system(async (tx) => {
    await tx.exec('INSERT INTO workspaces(id,name,owner_id) VALUES($1,$2,$3)', [
      w,
      'Concurrency',
      randomUUID(),
    ]);
    await tx.exec('INSERT INTO subscriptions(workspace_id) VALUES($1)', [w]);
  });
  await db.tenant(w, async (tx) => {
    await reserve(tx, w, 'prefill', 'reply', 1, testConfig, 99);
    await settle(tx, w, 'prefill', true, 1);
  });
  const outcomes = await Promise.allSettled(
    Array.from({ length: 8 }, (_, i) =>
      db.tenant(w, async (tx) => {
        const result = await reserve(tx, w, `race-${i}`, 'reply', 1, testConfig);
        await tx.exec('SELECT pg_sleep(0.01)');
        return result;
      }),
    ),
  );
  expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(7);
  const result = await db.tenant(w, (tx) => usage(tx, w));
  expect(result.used.reply + result.reserved.reply).toBe(100);
});
it('native PostgreSQL enforces the shared spending cap across competing workspaces', async () => {
  const ids = [randomUUID(), randomUUID()];
  await db.system(async (tx) => {
    for (const w of ids) {
      await tx.exec('INSERT INTO workspaces(id,name,owner_id) VALUES($1,$2,$3)', [
        w,
        'Global cap',
        randomUUID(),
      ]);
      await tx.exec('INSERT INTO subscriptions(workspace_id) VALUES($1)', [w]);
    }
  });
  const day = await db.system((tx) =>
    tx.must('SELECT reserved_micros+spent_micros total FROM spend_days WHERE day=current_date'),
  );
  const config = { ...testConfig, GLOBAL_DAILY_SPEND_MICROS: Number(day.total) + 5 };
  const outcomes = await Promise.allSettled(
    ids.map((w) => db.tenant(w, (tx) => reserve(tx, w, 'global-race', 'reply', 5, config))),
  );
  expect(outcomes.filter((o) => o.status === 'fulfilled')).toHaveLength(1);
  expect(outcomes.filter((o) => o.status === 'rejected')).toHaveLength(1);
});
