import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';
import { randomUUID } from 'node:crypto';
import { Tx, type Database } from '../src/db.js';
import { configSchema } from '../src/config.js';
import { createApp } from '../src/app.js';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { fileURLToPath } from 'node:url';
import type { AIProvider, EmailProvider } from '../src/providers.js';
import type { AssetStorage } from '../src/storage.js';
const objects = new Map<string, Buffer>();
export const mockStorage: AssetStorage = {
  put: async (key, bytes) => {
    objects.set(key, Buffer.from(bytes));
  },
  get: async (key) => {
    const bytes = objects.get(key);
    if (!bytes) throw new Error('Test asset not found');
    return bytes;
  },
  remove: async (key) => {
    objects.delete(key);
  },
};
export const testConfig = configSchema.parse({
  DATABASE_URL: 'postgres://test:test@localhost/lattice_test',
  APP_ORIGIN: 'https://dashboard.example',
  SUPABASE_URL: 'https://auth.example',
  LOG_LEVEL: 'silent',
});
export async function testDatabase(): Promise<Database> {
  const pg = new PGlite({ extensions: { vector } });
  await migrate(drizzle(pg), { migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)) });
  await pg.exec(
    'CREATE ROLE lattice_runtime; GRANT USAGE ON SCHEMA public TO lattice_runtime; GRANT ALL ON ALL TABLES IN SCHEMA public TO lattice_runtime; GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO lattice_runtime;',
  );
  async function transaction<T>(workspaceId: string | null, fn: (tx: Tx) => Promise<T>) {
    return pg.transaction(async (client) => {
      await client.exec('SET LOCAL ROLE lattice_runtime');
      await client.query("SELECT set_config('app.workspace_id',$1,true),set_config('app.system',$2,true)", [
        workspaceId ?? '',
        workspaceId ? 'off' : 'on',
      ]);
      if (workspaceId) await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId]);
      return fn(new Tx({ query: async (text, params) => client.query(text, params) }));
    });
  }
  return {
    system: (fn) => transaction(null, fn),
    tenant: (id, fn) => transaction(id, fn),
    close: () => pg.close(),
  };
}
export function mockAI(): AIProvider {
  const vector = new Array(1536).fill(0);
  vector[0] = 1;
  return {
    embed: async (texts) => texts.map(() => vector),
    answer: async (_q, _h, evidence) => ({
      content: evidence[0].excerpt,
      disposition: 'answer',
      citationIds: [evidence[0].chunkId],
      inputTokens: 100,
      outputTokens: 30,
      model: 'test-only',
    }),
    grade: async () => ({ supported: true, missingFacts: [], limitations: 'Test provider' }),
  };
}
export const mockEmail: EmailProvider = { send: async () => `test-${randomUUID()}` };
export async function harness(db: Database) {
  const owner = randomUUID(),
    member = randomUUID(),
    outsider = randomUUID();
  const app = createApp({
    db,
    config: testConfig,
    auth: { verify: async (token) => ({ id: token, email: `${token}@example.com` }) },
    storage: mockStorage,
  });
  await app.ready();
  let workspaceId = '';
  async function request(
    method: string,
    url: string,
    body?: unknown,
    who = owner,
    extra: Record<string, string> = {},
  ) {
    if (
      method === 'PATCH' &&
      url.includes('/sources/') &&
      body &&
      typeof body === 'object' &&
      !('expectedRevision' in body)
    ) {
      const sourceId = url.split('/').at(-1)!;
      const current = await db.tenant(workspaceId, (tx) =>
        tx.must('SELECT revision FROM sources WHERE workspace_id=$1 AND id=$2', [workspaceId, sourceId]),
      );
      body = { ...(body as Record<string, unknown>), expectedRevision: current.revision };
    }
    if (
      method === 'PATCH' &&
      url.endsWith('/settings') &&
      body &&
      typeof body === 'object' &&
      !('expectedRevision' in body)
    ) {
      const current = await db.tenant(workspaceId, (tx) =>
        tx.must('SELECT settings_revision FROM workspaces WHERE id=$1', [workspaceId]),
      );
      body = { ...(body as Record<string, unknown>), expectedRevision: current.settingsRevision };
    }
    return app.inject({
      method: method as any,
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${who}`, 'idempotency-key': randomUUID(), ...extra },
      ...(body === undefined ? {} : { payload: body as any }),
    });
  }
  const created = await request('POST', '/workspaces', {
    name: 'Fixture',
    agentName: 'Help',
    supportEmail: 'support@example.com',
    websiteUrl: 'https://customer.example',
  });
  if (created.statusCode !== 201) throw new Error(created.body);
  const { workspace, agent } = created.json().data;
  workspaceId = workspace.id;
  await db.system((tx) =>
    tx.exec("INSERT INTO memberships(workspace_id,user_id,email,role) VALUES($1,$2,$3,'member')", [
      workspace.id,
      member,
      `${member}@example.com`,
    ]),
  );
  return { app, owner, member, outsider, w: workspace.id as string, agent, request };
}
