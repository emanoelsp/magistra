import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: false,
    testTimeout: 20_000,
    include: ["tests/**/*.test.ts"],
    snapshotFormat: {
      printBasicPrototype: false,
      escapeString: false,
    },
  },
  resolve: {
    conditions: ["node", "default"],
  },
});
