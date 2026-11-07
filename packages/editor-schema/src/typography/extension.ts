import { Extension } from "@tiptap/core";
import { typographyRules, type SmartTypographyOptions } from "./rules";

/**
 * Smart quotes, dashes and the ellipsis as the author types. It is not part of the shared `extensions` list (the
 * exporters and the MCP server never type); the desktop editor adds it and the app setting switches it.
 */
export const SmartTypography = Extension.create<SmartTypographyOptions>({
  name: "smartTypography",
  addOptions() {
    return { enabled: () => true, language: () => "en" };
  },
  addInputRules() {
    return typographyRules(this.options);
  },
});
