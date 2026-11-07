import type { StoryStructure } from "../types";

export const HEROS_JOURNEY: StoryStructure = {
  id: "heros-journey",
  name: "Hero's Journey",
  summary: "Twelve stages of leaving home, being tested and coming back changed.",
  stages: [
    {
      id: "departure",
      name: "Departure",
      beats: [
        {
          id: "ordinary-world",
          title: "Ordinary world",
          summary: "The hero's everyday life, before anything changes. Show what they lack.",
        },
        {
          id: "call-to-adventure",
          title: "Call to adventure",
          summary:
            "A problem, challenge or invitation arrives and offers a way out of the ordinary.",
        },
        {
          id: "refusal-of-the-call",
          title: "Refusal of the call",
          summary: "The hero hesitates or says no. Fear and duty weigh on them.",
        },
        {
          id: "meeting-the-mentor",
          title: "Meeting the mentor",
          summary: "A guide gives advice, a gift or the nerve to begin.",
        },
        {
          id: "crossing-the-threshold",
          title: "Crossing the threshold",
          summary:
            "The hero commits and enters the special world, where the old rules no longer apply.",
        },
      ],
    },
    {
      id: "initiation",
      name: "Initiation",
      beats: [
        {
          id: "tests-allies-enemies",
          title: "Tests, allies and enemies",
          summary:
            "The hero learns the new world: who can be trusted, who cannot, and what it demands.",
        },
        {
          id: "approach",
          title: "Approach to the inmost cave",
          summary: "The hero prepares for the greatest danger and the plan is made.",
        },
        {
          id: "ordeal",
          title: "The ordeal",
          summary:
            "The hero faces the biggest fear or enemy so far. Something dies so something can be born.",
        },
        {
          id: "reward",
          title: "Reward",
          summary: "Having survived, the hero takes what they came for and sees what it cost.",
        },
      ],
    },
    {
      id: "return",
      name: "Return",
      beats: [
        {
          id: "road-back",
          title: "The road back",
          summary: "The hero heads home, but the consequences follow, and a final pursuit begins.",
        },
        {
          id: "resurrection",
          title: "Resurrection",
          summary: "One last test, in which the hero shows they have truly changed.",
        },
        {
          id: "return-with-the-elixir",
          title: "Return with the elixir",
          summary: "The hero comes home with something that can heal or change their world.",
        },
      ],
    },
  ],
};
