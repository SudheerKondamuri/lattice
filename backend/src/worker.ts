import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import { aiProvider, resend } from './providers.js';
import { recoverSpend, runOne } from './jobs.js';
import { scheduleDaily } from './maintenance.js';
const config = loadConfig();
const db = createDatabase(config);
const id = randomUUID();
const deps = { db, config, ai: aiProvider(config), email: resend(config) };
let stopped = false;
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    stopped = true;
  });
async function pulse() {
  await db.system((tx) =>
    tx.exec('INSERT INTO worker_heartbeats(id) VALUES($1) ON CONFLICT(id) DO UPDATE SET last_seen=now()', [
      id,
    ]),
  );
  await scheduleDaily(db);
  await recoverSpend(db);
}
await pulse();
const timer = setInterval(() => {
  void pulse().catch(() =>
    process.stderr.write(JSON.stringify({ level: 'error', code: 'WORKER_HEARTBEAT_FAILED' }) + '\n'),
  );
}, 30000);
await Promise.all(
  Array.from({ length: config.WORKER_CONCURRENCY }, async () => {
    while (!stopped) {
      try {
        if (!(await runOne(deps))) await sleep(1000);
      } catch {
        process.stderr.write(JSON.stringify({ level: 'error', code: 'WORKER_POLL_FAILED' }) + '\n');
        await sleep(3000);
      }
    }
  }),
);
clearInterval(timer);
await db.close();
