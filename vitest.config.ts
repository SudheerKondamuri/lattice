import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: {
    include: ["tests/frontend/**/*.test.{ts,tsx}"],
    environment: "jsdom", setupFiles: ["tests/frontend/setup.ts"],
    coverage: { provider: "v8", reportsDirectory: "frontend-infra/coverage", include: ["src/lib/api.ts", "src/lib/presentation.ts", "src/lib/forward.ts", "src/widget/storage.ts"], reporter: ["text", "json-summary"], thresholds: { lines: 80, statements: 80, branches: 80, functions: 80 } },
  },
});
