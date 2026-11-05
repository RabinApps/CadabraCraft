import { Node } from "@tiptap/core";

export const SceneBreak = Node.create({
  name: "sceneBreak",
  group: "block",
  parseHTML: () => [{ tag: "hr.scene-break" }],
  renderHTML: () => ["hr", { class: "scene-break" }],
});

/**
 * A page break inside a chapter: whatever follows it starts on a new page. It prints as nothing but the break (no line, no text), so
 * two in a row leave an empty page — the way an author puts a blank page in the middle of a chapter.
 */
export const PageBreak = Node.create({
  name: "pageBreak",
  group: "block",
  parseHTML: () => [{ tag: "hr.page-break" }],
  renderHTML: () => ["hr", { class: "page-break" }],
});

/** The states a scene can be in; an empty string means it has no state yet. */
export const SCENE_STATUSES = ["outline", "draft", "revised", "final"] as const;
export const MAX_SCENE_TITLE = 200;
export const MAX_SCENE_SYNOPSIS = 2000;
export const MAX_SCENE_POV = 120;
export const MAX_SCENE_LABEL = 60;
/** The longest story date: `YYYY-MM-DDTHH:MM`. */
export const MAX_SCENE_DATE = 16;
export const MAX_SCENE_TARGET = 1_000_000;
/** The most codex entries one scene may name in its cast. */
export const MAX_SCENE_CAST = 20;

/**
 * A scene: the blocks the author writes as one unit, with the planning notes the sidebar shows (`title`, `synopsis`, `pov`,
 * `status`, `label`, `target` in words, `date` (when it happens in the story: `YYYY-MM-DD`, optionally with `THH:MM`) and `cast`: the ids of the codex entries in the scene). It is structure only: no
 * exporter prints a scene's notes, and every exporter writes the children exactly as if the wrapper were not there. Adding it
 * does not bump `formatVersion` (chapter nodes never do).
 */
export const Scene = Node.create({
  name: "scene",
  group: "block",
  content: "block+",
  defining: true,
  addAttributes: () => ({
    id: { default: null },
    title: { default: "" },
    synopsis: { default: "" },
    pov: { default: "" },
    status: { default: "" },
    label: { default: "" },
    target: { default: null },
    date: { default: "" },
    cast: { default: [] },
  }),
  parseHTML: () => [{ tag: "section[data-scene]" }],
  // Only the marker is written: the notes are not HTML attributes, and a pasted scene keeps the children.
  renderHTML: () => ["section", { "data-scene": "" }, 0],
});

/** Inline footnote; its text lives in the node content. */
export const Footnote = Node.create({
  name: "footnote",
  group: "inline",
  inline: true,
  content: "text*",
  parseHTML: () => [{ tag: "span.footnote" }],
  renderHTML: () => ["span", { class: "footnote" }, 0],
});
