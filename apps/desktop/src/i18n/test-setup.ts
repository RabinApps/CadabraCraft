import { i18n } from "@lingui/core";
import { loadRegexEngine } from "../lib/search/match";

// Tests run in English; an empty catalog makes macros fall back to their source strings.
i18n.load("en", {});
i18n.activate("en");

// The regex engine loads on demand in the app; tests use it directly.
await loadRegexEngine();
