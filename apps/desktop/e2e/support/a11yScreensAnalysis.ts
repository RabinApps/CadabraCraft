import { dialogOf, menu, shown, type Screen } from "./a11yScreenHelpers";
import { newProject } from "./helpers";

/** The local analysis report (File > Analysis…, Q06): the dialog over an open book. */
export const analysisScreens: Screen[] = [
  {
    name: "Analysis report dialog",
    open: async (p) => {
      await newProject(p);
      await menu(p, "file.analysis");
      await shown(dialogOf(p, "Analysis"));
      await shown(dialogOf(p, "Analysis").getByRole("tab", { name: "Book" }));
    },
  },
];
