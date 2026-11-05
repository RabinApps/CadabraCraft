import type { StoryStructure } from "../types";

export const SAVE_THE_CAT: StoryStructure = {
  id: "save-the-cat",
  name: "Save the Cat",
  summary: "Fifteen beats with a target place for each, popular for screenplays and genre novels.",
  stages: [
    {
      id: "act-one",
      name: "Act one",
      beats: [
        {
          id: "opening-image",
          title: "Opening image",
          summary: "A snapshot of the hero and their world before the change. It sets the tone.",
        },
        {
          id: "theme-stated",
          title: "Theme stated",
          summary:
            "Someone says, often in passing, what the story is really about. The hero ignores it.",
        },
        {
          id: "set-up",
          title: "Set-up",
          summary:
            "Introduce the hero, the people around them and what needs fixing in their life.",
        },
        {
          id: "catalyst",
          title: "Catalyst",
          summary: "Life-changing news or an event knocks the hero off balance.",
        },
        {
          id: "debate",
          title: "Debate",
          summary: "The hero doubts: can I do this, should I? Prepare the choice.",
        },
        {
          id: "break-into-two",
          title: "Break into two",
          summary: "The hero chooses to act and steps into a new world or a new way of living.",
        },
      ],
    },
    {
      id: "act-two",
      name: "Act two",
      beats: [
        {
          id: "b-story",
          title: "B story",
          summary: "A new relationship begins, usually the one that carries the theme.",
        },
        {
          id: "fun-and-games",
          title: "Fun and games",
          summary:
            "The promise of the premise: the hero tries out the new world and the story delivers on its pitch.",
        },
        {
          id: "midpoint",
          title: "Midpoint",
          summary: "A false victory or false defeat. The stakes go up and the fun is over.",
        },
        {
          id: "bad-guys-close-in",
          title: "Bad guys close in",
          summary:
            "Opposition tightens from outside, and doubt and rivalry split the hero's team from within.",
        },
        {
          id: "all-is-lost",
          title: "All is lost",
          summary: "The worst happens. Whatever the hero thought they had is gone.",
        },
        {
          id: "dark-night-of-the-soul",
          title: "Dark night of the soul",
          summary: "The hero sits in the loss and finds, in it, the truth they were missing.",
        },
      ],
    },
    {
      id: "act-three",
      name: "Act three",
      beats: [
        {
          id: "break-into-three",
          title: "Break into three",
          summary:
            "The A story and the B story meet in a new plan, armed with what the hero has learned.",
        },
        {
          id: "finale",
          title: "Finale",
          summary:
            "The hero carries out the plan, defeats the opposition and proves the change is real.",
        },
        {
          id: "final-image",
          title: "Final image",
          summary:
            "The mirror of the opening image, showing how far the hero and the world have come.",
        },
      ],
    },
  ],
};
