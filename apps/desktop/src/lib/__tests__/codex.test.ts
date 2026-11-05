import { describe, expect, it } from "vitest";
import type { CodexEntry } from "@cadabracraft/format";
import { appearsIn, newCodexId, type ChapterScenes } from "../codex";
import type { SceneRow } from "../scenes";

const entry = (over: Partial<CodexEntry> = {}): CodexEntry => ({
  id: "mara",
  kind: "character",
  name: "Mara",
  aliases: ["Mara Vane"],
  summary: "",
  body: "",
  image: null,
  links: [],
  ...over,
});

const scene = (over: Partial<SceneRow> = {}): SceneRow => ({
  id: "sc-1",
  title: "The quay",
  status: "",
  pov: "",
  label: "",
  synopsis: "",
  target: null,
  date: "",
  cast: [],
  words: 0,
  ...over,
});

const chapters = (...c: ChapterScenes[]): ChapterScenes[] => c;

describe("appearsIn", () => {
  it("finds the scenes whose cast names the entry", () => {
    const book = chapters(
      {
        id: "chapter-1",
        title: "The Harbour",
        scenes: [scene({ cast: ["mara"] }), scene({ id: "sc-2", title: "The wall" })],
      },
      {
        id: "chapter-2",
        title: "The Light",
        scenes: [scene({ id: "sc-3", title: "Night", cast: ["mara", "quay"] })],
      },
    );
    expect(appearsIn(entry(), book)).toEqual([
      { chapterId: "chapter-1", chapter: "The Harbour", sceneId: "sc-1", scene: "The quay" },
      { chapterId: "chapter-2", chapter: "The Light", sceneId: "sc-3", scene: "Night" },
    ]);
  });

  it("counts a POV written as the entry's name, id or an alias, in any case", () => {
    const book = chapters({
      id: "chapter-1",
      title: "The Harbour",
      scenes: [
        scene({ pov: " mara " }),
        scene({ id: "sc-2", pov: "MARA VANE" }),
        scene({ id: "sc-3", pov: "mara" }),
        scene({ id: "sc-4", pov: "Ada" }),
      ],
    });
    expect(appearsIn(entry(), book).map((a) => a.sceneId)).toEqual(["sc-1", "sc-2", "sc-3"]);
  });

  it("finds nothing for a scene that does not name the entry, or without an entry", () => {
    const book = chapters({
      id: "chapter-1",
      title: "The Harbour",
      scenes: [scene({ cast: ["ada"], pov: "Ada" })],
    });
    expect(appearsIn(entry(), book)).toEqual([]);
    expect(appearsIn(null, book)).toEqual([]);
  });

  it("lists a scene once even when its cast and its POV both name the entry", () => {
    const book = chapters({
      id: "chapter-1",
      title: "The Harbour",
      scenes: [scene({ cast: ["mara"], pov: "Mara" })],
    });
    expect(appearsIn(entry(), book)).toHaveLength(1);
  });
});

describe("newCodexId", () => {
  it("is new every time and usable in a cast", () => {
    const a = newCodexId();
    expect(a).not.toBe(newCodexId());
    expect(a).toMatch(/^cd-[0-9a-f]{8}$/);
  });
});
