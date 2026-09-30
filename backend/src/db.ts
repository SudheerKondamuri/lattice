import pg from 'pg';
import type { Config } from './config.js';
import { AppError, required } from './errors.js';
export interface Executor {
  query(text: string, params?: unknown[]): Promise<{ rows: Record<string, any>[] }>;
}
export type Row = Record<string, any>;
export class Tx {
  constructor(private executor: Executor) {}
  async rows<T = Row>(sql: string, params: unknown[] = []): Promise<T[]> {
    const { rows } = await this.executor.query(sql, params);
    return rows.map((row) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()),
          value instanceof Date ? value.toISOString() : typeof value === 'bigint' ? Number(value) : value,
        ]),
      ),
    ) as T[];
  }
  async one<T = Row>(sql: string, params: unknown[] = []): Promise<T | undefined> {
    return (await this.rows<T>(sql, params))[0];
  }
  async must<T = Row>(sql: string, params: unknown[] = []): Promise<T> {
    return required(await this.one<T>(sql, params));
  }
  async exec(sql: string, params: unknown[] = []) {
    await this.executor.query(sql, params);
  }
}
export interface Database {
  system<T>(fn: (tx: Tx) => Promise<T>): Promise<T>;
  tenant<T>(workspaceId: string, fn: (tx: Tx) => Promise<T>): Promise<T>;
  close(): Promise<void>;
}
export function createDatabase(config: Pick<Config, 'DATABASE_URL' | 'DATABASE_POOL_SIZE'>): Database {
  const pool = new pg.Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_SIZE,
    statement_timeout: 15000,
    idle_in_transaction_session_timeout: 30000,
  });
  async function transaction<T>(workspaceId: string | null, fn: (tx: Tx) => Promise<T>) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query("SELECT set_config('app.workspace_id',$1,true),set_config('app.system',$2,true)", [
        workspaceId ?? '',
        workspaceId ? 'off' : 'on',
      ]);
      if (workspaceId) {
        const result = await client.query('SELECT id FROM workspaces WHERE id=$1 FOR UPDATE', [workspaceId]);
        if (!result.rows.length) throw new AppError('NOT_FOUND', 'Workspace not found', 404);
      }
      const result = await fn(new Tx(client));
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
  return {
    system: (fn) => transaction(null, fn),
    tenant: (id, fn) => transaction(id, fn),
    close: () => pool.end(),
  };
}
