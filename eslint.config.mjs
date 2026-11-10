import js from "@eslint/js";
import tseslint from "typescript-eslint";
import importX from "eslint-plugin-import-x";
import jsxA11y from "eslint-plugin-jsx-a11y";
import prettier from "eslint-config-prettier";
import globals from "globals";
import { createTypeScriptImportResolver } from "eslint-import-resolver-typescript";

export default tseslint.config(
  {
    ignores: [
      "**/dist/**",
      "out/**",
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
      // Structure guardrails (CLAUDE.md, "Code organization"). scripts/check-size.mjs covers Rust, CSS and folder size.
      "max-lines": ["error", { max: 400, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": [
        "error",
        { max: 120, skipBlankLines: true, skipComments: true, IIFEs: true },
      ],
      complexity: ["error", 20],
      "max-depth": ["error", 4],
      "max-params": ["error", 5],
    },
  },
  {
    // Static accessibility rules for the desktop UI (docs/accessibility.md).
    files: ["apps/desktop/src/**/*.tsx"],
    ...jsxA11y.flatConfigs.recommended,
  },
  {
    // Reviewed false positives and deliberate patterns, kept per file so new code still gets the rule.
    files: ["apps/desktop/src/**/*.tsx"],
    rules: {
      // Dialogs and inline editors move focus to their first field on purpose.
      "jsx-a11y/no-autofocus": "off",
    },
  },
  {
    files: [
      // Scroll regions are focusable so keyboard users can scroll them.
      "apps/desktop/src/app/dialogs/import/ImportReportDialog.tsx",
      "apps/desktop/src/app/dialogs/LicensesDialog.tsx",
    ],
    rules: { "jsx-a11y/no-noninteractive-tabindex": "off" },
  },
  {
    // The sidebar divider follows the ARIA window splitter pattern: a focusable separator, resized with the arrow keys.
    files: ["apps/desktop/src/app/shell/sidebar/SidebarResizeHandle.tsx"],
    rules: {
      "jsx-a11y/no-noninteractive-element-interactions": "off",
      "jsx-a11y/no-noninteractive-tabindex": "off",
    },
  },
  {
    files: [
      // Label text sits in child spans the rule cannot see.
      "apps/desktop/src/app/dialogs/AddLanguageDialog.tsx",
      "apps/desktop/src/app/board/StructureDialog.tsx",
      // Radio children carry the roving tabindex.
      "apps/desktop/src/app/export/Templates.tsx",
      // Combobox pattern: the input keeps focus and points at the option with aria-activedescendant.
      "apps/desktop/src/app/quicknav/QuickPicker.tsx",
      // Shortcut handler for the find bar group.
      "apps/desktop/src/editor/find/FindBar.tsx",
      // Children come through the rest props.
      "apps/desktop/src/ui/SectionHeading.tsx",
    ],
    rules: {
      "jsx-a11y/label-has-associated-control": "off",
      "jsx-a11y/interactive-supports-focus": "off",
      "jsx-a11y/click-events-have-key-events": "off",
      "jsx-a11y/no-noninteractive-element-interactions": "off",
      "jsx-a11y/heading-has-content": "off",
    },
  },
  {
    // Reference previews play the author's own files; there is no caption source.
    files: ["apps/desktop/src/app/references/Previews.tsx"],
    rules: { "jsx-a11y/media-has-caption": "off" },
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
    // Tests may be longer, but not unbounded (scripts/check-size.mjs also enforces 800).
    files: [
      "**/__tests__/**",
      "**/*.test.ts",
      "**/*.spec.ts",
      "**/e2e/**",
      "**/e2e-screenshots/**",
    ],
    rules: {
      "max-lines": ["error", { max: 800, skipBlankLines: true, skipComments: true }],
      "max-lines-per-function": "off",
      complexity: "off",
    },
  },
  prettier,
);
