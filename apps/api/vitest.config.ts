import { defineConfig } from "vitest/config";

// Only the sources. `nest build` emits the test files into dist as well, and
// without this vitest would run each suite twice, once against stale output.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
  },
});
