import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { fileURLToPath } from 'node:url';
import { loadConfig } from './config.js';
const pool = new pg.Pool({
  connectionString: process.env.MIGRATION_DATABASE_URL || loadConfig().DATABASE_URL,
});
try {
  await migrate(drizzle(pool), {
    migrationsFolder: fileURLToPath(new URL('../migrations', import.meta.url)),
  });
} finally {
  await pool.end();
}
