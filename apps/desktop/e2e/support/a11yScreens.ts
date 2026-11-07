import { baseScreens } from "./a11yScreensBase";
import { dropScreens } from "./a11yScreensDrop";
import { moreScreens } from "./a11yScreensMore";
import type { Screen } from "./a11yScreenHelpers";

export type { Screen };
export { moreScreens };

/** Every screen the accessibility specs audit. */
export const screens: Screen[] = [...baseScreens, ...moreScreens, ...dropScreens];
