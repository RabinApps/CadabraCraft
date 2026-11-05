import { STORY_STRUCTURES } from "./structures";
import type { PlaceholderScene, StoryStructure } from "./types";

export type * from "./types";
export { STORY_STRUCTURES };

/** The structure with this id, or undefined. */
export const getStructure = (id: string): StoryStructure | undefined =>
  STORY_STRUCTURES.find((s) => s.id === id);

/** How many beats (so how many scenes) a structure has. */
export const beatCount = (s: StoryStructure): number =>
  s.stages.reduce((n, stage) => n + stage.beats.length, 0);

/**
 * The structure as scene placeholders, in order: each beat is a scene with its title, its summary as the synopsis, its
 * stage as the label, the `outline` status and an empty body. Nothing else is touched: this only makes new scenes.
 * `newId` makes each scene's id; two beats given the same id is a bug in the caller, so it throws instead of writing a
 * chapter with a duplicate.
 */
export function placeholderScenes(s: StoryStructure, newId: () => string): PlaceholderScene[] {
  const seen = new Set<string>();
  return s.stages.flatMap((stage) =>
    stage.beats.map((beat) => {
      const id = newId();
      if (seen.has(id)) throw new Error(`newId returned ${id} twice`);
      seen.add(id);
      return {
        type: "scene" as const,
        attrs: {
          id,
          title: beat.title,
          synopsis: beat.summary,
          pov: "" as const,
          status: "outline" as const,
          label: stage.name,
          target: null,
          date: "" as const,
          cast: [] as [],
        },
        content: [{ type: "paragraph" as const }] as [{ type: "paragraph" }],
      };
    }),
  );
}
