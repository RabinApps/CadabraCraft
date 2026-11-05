import type { StoryStructure } from "./types";

/**
 * The structures on offer, as data. The summaries are written for this app in plain words (the beat names follow common
 * usage; the frameworks themselves are not copyrightable, their wording is). English only: see docs/architecture.md,
 * "Story-structure templates".
 */
export const STORY_STRUCTURES: readonly StoryStructure[] = [
  {
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
  },
  {
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
            summary:
              "The hero heads home, but the consequences follow, and a final pursuit begins.",
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
  },
  {
    id: "save-the-cat",
    name: "Save the Cat",
    summary:
      "Fifteen beats with a target place for each, popular for screenplays and genre novels.",
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
  },
  {
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
  },
  {
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
  },
];
