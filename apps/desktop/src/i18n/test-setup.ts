import { i18n } from "@lingui/core";

// Tests run in English; an empty catalog makes macros fall back to their source strings.
i18n.load("en", {});
i18n.activate("en");
