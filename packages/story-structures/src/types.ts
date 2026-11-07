/** One beat of a story structure: what happens, written as a prompt the author replaces with their own story. */
export interface StoryBeat {
  /** Stable within its structure (`ordinary-world`); never shown. */
  id: string;
  title: string;
  /** One or two sentences about what the beat is for. Becomes the scene's synopsis. */
  summary: string;
}

/** A named run of beats (an act, a stage). Becomes the scene's label. */
export interface StoryStage {
  id: string;
  name: string;
  beats: StoryBeat[];
}

/** A story structure: ordered stages of ordered beats. Plain data, so the app and the tests read the same thing. */
export interface StoryStructure {
  id: string;
  name: string;
  /** What the structure is, in a sentence. */
  summary: string;
  stages: StoryStage[];
}

/** A scene node as a chapter file holds it: the planning notes filled in, an empty body. */
export interface PlaceholderScene {
  type: "scene";
  attrs: {
    id: string;
    title: string;
    synopsis: string;
    pov: "";
    status: "outline";
    label: string;
    target: null;
    date: "";
    cast: [];
  };
  content: [{ type: "paragraph" }];
}
