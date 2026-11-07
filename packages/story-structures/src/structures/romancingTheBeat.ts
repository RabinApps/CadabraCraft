import type { StoryStructure } from "../types";

export const ROMANCING_THE_BEAT: StoryStructure = {
  id: "romancing-the-beat",
  name: "Romancing the Beat",
  summary: "Twelve beats of a love story, from meeting to the happy ending.",
  stages: [
    {
      id: "falling",
      name: "Falling for each other",
      beats: [
        {
          id: "setup",
          title: "Setup",
          summary: "Show each lead alone, with the wound or belief that keeps love out of reach.",
        },
        {
          id: "meet-cute",
          title: "Meet cute",
          summary: "The leads meet in a way the reader remembers, and each makes an impression.",
        },
        {
          id: "no-way",
          title: "No way",
          summary: "Each lead has a reason to say this will never work, so they resist.",
        },
        {
          id: "adhesion",
          title: "Adhesion",
          summary:
            "Something keeps them together: a job, a bet, a secret, a storm. They cannot just walk away.",
        },
        {
          id: "deepening-desire",
          title: "Deepening desire",
          summary: "Time together breaks down the defences. They see each other's best sides.",
        },
        {
          id: "maybe-this-could-work",
          title: "Maybe this could work",
          summary:
            "Hope arrives: the leads start to believe in it, and a first real closeness follows.",
        },
      ],
    },
    {
      id: "breaking",
      name: "Breaking apart",
      beats: [
        {
          id: "midpoint-of-desire",
          title: "Midpoint of desire",
          summary:
            "They cross a line, a kiss or a night together, and commit to the relationship in some way.",
        },
        {
          id: "retreat",
          title: "Retreat",
          summary: "The old wound shows up again. Doubt creeps in and the leads pull back.",
        },
        {
          id: "dark-moment",
          title: "Dark moment",
          summary:
            "The breakup. The thing each feared happens, and it looks as if love will not survive.",
        },
      ],
    },
    {
      id: "together",
      name: "Together again",
      beats: [
        {
          id: "wake-up-call",
          title: "Wake-up call",
          summary:
            "Each lead sees what they must change, and that being without the other is worse than the risk.",
        },
        {
          id: "grand-gesture",
          title: "Grand gesture",
          summary: "One lead, or both, takes a public risk that proves the change is real.",
        },
        {
          id: "happily-ever-after",
          title: "Happily ever after",
          summary:
            "The couple is together, and the reader sees that the happy ending is earned and will last.",
        },
      ],
    },
  ],
};
