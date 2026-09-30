import { defineConfig } from "vitest/config"

// The checks in tests/api talk to the local Supabase the shop uses (see tests/README.md).
export default defineConfig({
  test: {
    include: ["tests/api/**/*.test.ts"],
    globalSetup: ["tests/api/setup.ts"],
    // They share one shop (stock, order limits), so one file at a time.
    fileParallelism: false,
    testTimeout: 60_000,
    hookTimeout: 60_000,
  },
})
