import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importX from "eslint-plugin-import-x";
import prettier from "eslint-config-prettier";
import globals from "globals";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "**/node_modules/**",
      "**/target/**",
      "**/test-results/**",
      "**/coverage/**",
      "**/playwright-report/**",
      "apps/desktop/src-tauri/**",
      "apps/website/**",
      "tools/**",
      ".claude/**",
      "**/vendor/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
    plugins: { "import-x": importX },
    settings: { "import-x/resolver-next": [createTypeScriptImportResolver()] },
    rules: {
      "import-x/no-cycle": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Guardrail against files regrowing into grab-bags.
      "max-lines": ["warn", { max: 400, skipBlankLines: true, skipComments: true }],
    },
  },
  {
    // packages/* must never depend on the desktop app (CLAUDE.md).
    files: ["packages/**/*.{ts,tsx,mjs}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/apps/desktop/**", "@cadabracraft/desktop*"],
              message: "packages/* must not import from apps/desktop.",
            },
          ],
        },
      ],
    },
  },
  {
    // Tests are allowed to be long.
    files: ["**/__tests__/**", "**/*.test.ts", "**/*.spec.ts", "**/e2e/**"],
    rules: { "max-lines": "off" },
  },
  prettier,
);
