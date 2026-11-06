import { plural } from "@lingui/core/macro";

/** " (N untranslated pages left out)" for the notice, or nothing when every page was exported. */
export const left = (n: number) =>
  n
    ? ` (${plural(n, { one: "# untranslated page left out", other: "# untranslated pages left out" })})`
    : "";
