import { dialogOf, menu, shown, type Screen } from "./a11yScreenHelpers";
import { newProject } from "./helpers";
import { dayKey, seedWritingStats } from "./writingStats";

/** The writing history (File > Writing history…, M02): the dialog over an open book, with a few days of words. */
export const historyScreens: Screen[] = [
  {
    name: "Writing history dialog",
    noText: true,
    open: async (p) => {
      await newProject(p);
      await seedWritingStats(p, { [dayKey(0)]: 612, [dayKey(-1)]: 300, [dayKey(-2)]: 1400 });
      await menu(p, "file.writingHistory");
      await shown(dialogOf(p, "History"));
      await shown(dialogOf(p, "History").getByRole("table", { name: "Last 24 weeks" }));
    },
  },
];
