import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
    globals: true,
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,
    sequence: { concurrent: false },
  },
  // No resolve.tsconfigPaths — @hedge-lang/compiler resolves via package.json
  // exports to dist/, not the TypeScript source tree. The pretest script ensures
  // dist/ is built before this config is used.
});
