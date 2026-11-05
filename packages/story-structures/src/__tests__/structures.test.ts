import { describe, expect, it } from "vitest";
import { MAX_SCENE_LABEL, MAX_SCENE_SYNOPSIS, MAX_SCENE_TITLE } from "@cadabracraft/editor-schema";
import { isValidSceneId } from "@cadabracraft/shared";
import { STORY_STRUCTURES, beatCount, getStructure, placeholderScenes } from "../index";

const counter = () => {
  let n = 0;
  return () => `sc-${++n}`;
};

describe("the structures", () => {
  it("offers the five frameworks, in a stable order", () => {
    expect(STORY_STRUCTURES.map((s) => s.id)).toEqual([
      "three-act",
      "heros-journey",
      "save-the-cat",
      "romancing-the-beat",
      "story-circle",
    ]);
  });

  it("has the known beat counts", () => {
    const counts = Object.fromEntries(STORY_STRUCTURES.map((s) => [s.id, beatCount(s)]));
    expect(counts).toEqual({
      "three-act": 8,
      "heros-journey": 12,
      "save-the-cat": 15,
      "romancing-the-beat": 12,
      "story-circle": 8,
    });
  });

  it("keeps ids unique, text filled in and every note within the scene limits", () => {
    const ids = STORY_STRUCTURES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const s of STORY_STRUCTURES) {
      expect(s.name.trim()).not.toBe("");
      expect(s.summary.trim()).not.toBe("");
      expect(s.stages.length).toBeGreaterThan(0);
      const stageIds = s.stages.map((g) => g.id);
      expect(new Set(stageIds).size).toBe(stageIds.length);
      const beatIds = s.stages.flatMap((g) => g.beats.map((b) => b.id));
      expect(new Set(beatIds).size).toBe(beatIds.length);
      for (const stage of s.stages) {
        expect(stage.name.length).toBeGreaterThan(0);
        expect(stage.name.length).toBeLessThanOrEqual(MAX_SCENE_LABEL);
        expect(stage.beats.length).toBeGreaterThan(0);
        for (const b of stage.beats) {
          expect(b.title.length).toBeGreaterThan(0);
          expect(b.title.length).toBeLessThanOrEqual(MAX_SCENE_TITLE);
          expect(b.summary.length).toBeGreaterThan(0);
          expect(b.summary.length).toBeLessThanOrEqual(MAX_SCENE_SYNOPSIS);
        }
      }
    }
  });
});

describe("getStructure", () => {
  it("finds a structure by id and says nothing for an unknown one", () => {
    expect(getStructure("save-the-cat")?.name).toBe("Save the Cat");
    expect(getStructure("nope")).toBeUndefined();
  });
});

describe("placeholderScenes", () => {
  it("makes one outline scene per beat, in order, with the stage as label and an empty body", () => {
    const s = getStructure("story-circle")!;
    const scenes = placeholderScenes(s, counter());
    expect(scenes).toHaveLength(8);
    expect(scenes.map((x) => x.attrs.title)).toEqual([
      "You",
      "Need",
      "Go",
      "Search",
      "Find",
      "Take",
      "Return",
      "Change",
    ]);
    expect(scenes[0]).toEqual({
      type: "scene",
      attrs: {
        id: "sc-1",
        title: "You",
        synopsis: s.stages[0]!.beats[0]!.summary,
        pov: "",
        status: "outline",
        label: "The familiar world",
        target: null,
        date: "",
        cast: [],
      },
      content: [{ type: "paragraph" }],
    });
    expect(scenes[7]!.attrs.label).toBe("Back again");
  });

  it("makes ids the schema accepts for every structure", () => {
    for (const s of STORY_STRUCTURES) {
      const scenes = placeholderScenes(s, counter());
      expect(scenes).toHaveLength(beatCount(s));
      expect(scenes.every((x) => isValidSceneId(x.attrs.id))).toBe(true);
    }
  });

  it("throws rather than reuse an id", () => {
    expect(() => placeholderScenes(getStructure("three-act")!, () => "same")).toThrow(
      "newId returned same twice",
    );
  });
});
