import { defineConfig } from "vitest/config";
import path from "node:path";

// Integration tests against the local Supabase stack (`pnpm db:start` first).
export default defineConfig({
  resolve: { alias: { "@": path.resolve(__dirname, "src") } },
  test: {
    include: ["tests/db/**/*.test.ts"],
    environment: "node",
    fileParallelism: false,
    testTimeout: 30_000,
  },
});
