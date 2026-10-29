import { defineConfig } from "@lingui/conf";
import { formatter } from "@lingui/format-po";

export default defineConfig({
  sourceLocale: "en",
  locales: ["en", "es", "it", "fr", "de", "he", "ar", "pseudo"],
  pseudoLocale: "pseudo",
  fallbackLocales: { default: "en" },
  catalogs: [{ path: "<rootDir>/src/i18n/locales/{locale}/messages", include: ["src"] }],
  format: formatter({ lineNumbers: false }),
});
