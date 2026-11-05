import type { StoryStructure } from "../types";

export const THREE_ACT: StoryStructure = {
  id: "three-act",
  name: "Three-act structure",
  summary: "Setup, confrontation and resolution: the shape most stories fall back on.",
  stages: [
    {
      id: "act-one",
      name: "Act one: Setup",
      beats: [
        {
          id: "setup",
          title: "Setup",
          summary:
            "Show the hero in their ordinary life, what they want and what is missing, and the world the story lives in.",
        },
        {
          id: "inciting-incident",
          title: "Inciting incident",
          summary:
            "Something happens that disturbs the ordinary life and raises the story question.",
        },
        {
          id: "first-plot-point",
          title: "First plot point",
          summary:
            "The hero commits to the problem and cannot go back. Act one ends and the story turns.",
        },
      ],
    },
    {
      id: "act-two",
      name: "Act two: Confrontation",
      beats: [
        {
          id: "rising-action",
          title: "Rising action",
          summary:
            "The hero pursues the goal against growing opposition; each attempt costs more than the last.",
        },
        {
          id: "midpoint",
          title: "Midpoint",
          summary:
            "A reversal or revelation changes what the hero thinks the story is about, and raises the stakes.",
        },
        {
          id: "all-is-lost",
          title: "Crisis",
          summary:
            "The plan fails and the hero hits the lowest point. The second plot point sends them into the last act.",
        },
      ],
    },
    {
      id: "act-three",
      name: "Act three: Resolution",
      beats: [
        {
          id: "climax",
          title: "Climax",
          summary:
            "The hero faces the main opposition, using what they learned, and the story question is answered.",
        },
        {
          id: "resolution",
          title: "Resolution",
          summary:
            "Show the new normal and what the events changed, for the hero and for the world.",
        },
      ],
    },
  ],
};
