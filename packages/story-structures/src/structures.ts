import type { StoryStructure } from "./types";
import { THREE_ACT } from "./structures/threeAct";
import { HEROS_JOURNEY } from "./structures/herosJourney";
import { SAVE_THE_CAT } from "./structures/saveTheCat";
import { ROMANCING_THE_BEAT } from "./structures/romancingTheBeat";
import { STORY_CIRCLE } from "./structures/storyCircle";

/**
 * The structures on offer, as data (one file per structure under ./structures). The summaries are written for this app in plain
 * words (the beat names follow common usage; the frameworks themselves are not copyrightable, their wording is). English only:
 * see docs/architecture.md, "Story-structure templates".
 */
export const STORY_STRUCTURES: readonly StoryStructure[] = [
  THREE_ACT,
  HEROS_JOURNEY,
  SAVE_THE_CAT,
  ROMANCING_THE_BEAT,
  STORY_CIRCLE,
];
