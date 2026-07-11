import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: "node",

    /* Monorepo-friendly discovery */
    include: [
      "toolchain/**/test/**/*.{test,spec}.ts",
      "toolchain/**/**/*.{test,spec}.ts",
      "stdlib/**/*.{test,spec}.ts",
    ],

    exclude: [
      "node_modules",
      "dist",
      "toolchain/compiler-conformance-tests/**",
    ],

    /* Compiler-grade discipline */
    globals: true,
    clearMocks: true,
    restoreMocks: true,
    mockReset: true,

    /* Better debugging for compiler work */
    reporters: ["default"],

    /* Important for AST-heavy work */
    sequence: {
      concurrent: false,
    },

    /* Coverage (optional but recommended) */
    coverage: {
      provider: "v8",
      reporter: ["text", "json", "html"],
      exclude: ["node_modules", "dist", "tests"],
    },
  },
});
