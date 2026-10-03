import { loadConfig } from './config.js';
import { createDatabase } from './db.js';
import { supabaseAuth } from './auth.js';
import { createApp } from './app.js';
const config = loadConfig();
const db = createDatabase(config);
const app = createApp({ db, config, auth: supabaseAuth(config) });
for (const signal of ['SIGINT', 'SIGTERM'])
  process.once(signal, () => {
    void app.close().then(() => db.close());
  });
await app.listen({ host: config.HOST, port: config.PORT });
