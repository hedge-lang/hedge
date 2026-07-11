import js from "@eslint/js";
import tseslint from "typescript-eslint";
import json from "@eslint/json";
import markdown from "@eslint/markdown";
import prettier from "eslint-config-prettier/flat";
import boundaries from "eslint-plugin-boundaries";
import * as jsoncParser from "jsonc-eslint-parser";
import { defineConfig } from "eslint/config";

export default defineConfig([
  /* =========================================================
       BASE JAVASCRIPT RULES
    ========================================================= */
  {
    ...js.configs.recommended,
    files: ["**/*.{mjs,cjs,js,jsx}"],
  },

  /* =========================================================
       TYPESCRIPT STRICT LAYER (YOUR CONFIG, PRESERVED)
    ========================================================= */
  ...tseslint.configs.strict.map((config) => ({
    ...config,
    files: ["**/*.ts"],
  })),

  ...tseslint.configs.strictTypeCheckedOnly.map((config) => ({
    ...config,
    files: ["**/*.ts"],
    languageOptions: {
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
  })),

  {
    files: ["**/*.ts"],
    rules: {
      /* ===== your strict TS rules ===== */
      "@typescript-eslint/consistent-type-imports": "error",
      "@typescript-eslint/explicit-function-return-type": "error",
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true },
      ],
      "@typescript-eslint/typedef": ["error", { parameter: true }],
      "class-methods-use-this": "error",

      /* ===== additional safety (from compiler-grade layer) ===== */
      "@typescript-eslint/no-non-null-assertion": "error",
      "no-param-reassign": "error",
    },
  },

  /* =========================================================
       COMPILER ARCHITECTURE BOUNDARIES (NEW LAYER)
    ========================================================= */
  {
    plugins: {
      boundaries,
    },
    settings: {
      "boundaries/elements": [
        { type: "compiler", pattern: "toolchain/compiler/**" },
        { type: "runtime", pattern: "toolchain/runtime/**" },
        { type: "cli", pattern: "toolchain/cli/**" },
        {
          type: "compiler-conformance-tests",
          pattern: "toolchain/compiler-conformance-tests/**",
        },
      ],
    },
    rules: {
      "boundaries/dependencies": [
        "error",
        {
          default: "disallow",
          policies: [
            {
              from: { type: "compiler" },
              allow: [
                { to: { type: "compiler" } },
                { to: { type: "runtime" } },
              ],
            },
            {
              from: { type: "runtime" },
              allow: [{ to: { type: "runtime" } }],
            },
            {
              from: { type: "cli" },
              allow: [
                { to: { type: "compiler" } },
                { to: { type: "runtime" } },
                { to: { type: "cli" } },
              ],
            },
            {
              from: { type: "compiler-conformance-tests" },
              allow: [{ to: { type: "compiler" } }],
            },
          ],
        },
      ],
    },
  },

  /* =========================================================
       COMPILER-ONLY AST / IR SAFETY LAYER
    ========================================================= */
  {
    files: ["toolchain/compiler/**"],
    rules: {
      /* no unsafe AST mutation */
      "no-restricted-syntax": [
        "error",

        {
          selector:
            "AssignmentExpression[left.object.name=/^(ast|node|expr|stmt)$/]",
          message:
            "Do not mutate AST nodes directly. Use explicit transform passes.",
        },

        {
          selector: "TSAsExpression",
          message:
            "Avoid type assertions in compiler core. Use explicit narrowing.",
        },
      ],

      /* stricter correctness for compiler logic */
      complexity: ["error", 12],
    },
  },

  /* =========================================================
       JSON (general)
    ========================================================= */
  {
    files: ["**/*.json"],
    ignores: ["**/package-lock.json", "**/tsconfig*.json"],
    plugins: { json },
    language: "json/json",
    rules: json.configs.recommended.rules,
  },

  /* =========================================================
       TSConfig / JSONC
    ========================================================= */
  {
    files: ["**/tsconfig*.json"],
    languageOptions: {
      parser: jsoncParser,
    },
    rules: {
      // Keep it permissive but schema-aware tooling can be added later
      "no-irregular-whitespace": "off",
    },
  },

  /* =========================================================
       MARKDOWN SUPPORT
    ========================================================= */
  markdown.configs.recommended,
  {
    files: ["**/*.md"],
    language: "markdown/gfm",
  },

  /* =========================================================
       IGNORE PATTERNS
    ========================================================= */
  {
    ignores: [
      "**/{coverage,dist,node_modules}/**",
      "**/examples/**/*.{d.ts,js}",
    ],
  },

  /* =========================================================
       PRETTIER OVERRIDE (MUST BE LAST)
    ========================================================= */
  prettier,
]);
