import type { StoryStructure } from "../types";

export const STORY_CIRCLE: StoryStructure = {
  id: "story-circle",
  name: "Story Circle",
  summary:
    "Eight steps around a circle: a character leaves comfort, gets what they want and returns changed.",
  stages: [
    {
      id: "familiar",
      name: "The familiar world",
      beats: [
        {
          id: "you",
          title: "You",
          summary: "A character in a zone of comfort. Show who they are and where they live.",
        },
        {
          id: "need",
          title: "Need",
          summary: "But they want something, and something is not quite right.",
        },
      ],
    },
    {
      id: "unfamiliar",
      name: "The unfamiliar world",
      beats: [
        {
          id: "go",
          title: "Go",
          summary: "They enter an unfamiliar situation, whether they choose to or not.",
        },
        {
          id: "search",
          title: "Search",
          summary: "They adapt to it, and meet trouble and helpers on the way.",
        },
        {
          id: "find",
          title: "Find",
          summary: "They get what they were after, or think they have.",
        },
        {
          id: "take",
          title: "Take",
          summary: "They pay a heavy price for it, and the story turns.",
        },
      ],
    },
    {
      id: "back",
      name: "Back again",
      beats: [
        {
          id: "return",
          title: "Return",
          summary: "They go back to the familiar world.",
        },
        {
          id: "change",
          title: "Change",
          summary: "Having changed, they now change things, or show what they have become.",
        },
      ],
    },
  ],
};
