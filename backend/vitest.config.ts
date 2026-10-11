import { defineConfig } from 'vitest/config';
export default defineConfig({ test: { fileParallelism: false, testTimeout: 30000, hookTimeout: 60000, coverage: { provider: 'v8', include: ['src/**/*.ts'], exclude: ['src/server.ts', 'src/worker.ts', 'src/migrate.ts', 'src/schema.ts'] } } });
